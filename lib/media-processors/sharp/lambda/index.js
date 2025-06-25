process.env.FONTCONFIG_PATH = "/opt/etc/fonts";
process.env.FONTCONFIG_FILE = "/opt/etc/fonts/fonts.conf";
process.env.LD_LIBRARY_PATH = "/opt/lib";
process.env.GSK_RENDERER = "cairo";

const fs = require("fs");

const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const sharp = require("sharp");
const bmp = require("sharp-bmp");
const exifReader = require("exif-reader");

const {
  EventBridgeClient,
  PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");

const s3 = new S3Client({ region: process.env.AWS_REGION });
const eventBridge = new EventBridgeClient({ region: process.env.AWS_REGION });

const MIME_TO_EXT = {
  "image/jpeg": "jpeg",
};

const FONT_CACHE_DIR = "/tmp/font-cache";

if (!fs.existsSync(FONT_CACHE_DIR)) {
  fs.mkdirSync(FONT_CACHE_DIR, { recursive: true });
  fs.chmodSync(FONT_CACHE_DIR, 0o777);
}

exports.handler = async (event) => {
  const {
    SQS_QUEUE_MAX_RECEIVE_COUNT,
    BUCKET_NAME,
    EVENT_BUS_NAME,
    EVENT_SOURCE,
  } = process.env;
  const record = event.Records[0];
  const receiveCount = Number(record.attributes.ApproximateReceiveCount);
  const maxReceiveCount = Number(SQS_QUEUE_MAX_RECEIVE_COUNT);
  const isLastReceive = receiveCount === maxReceiveCount;
  const {
    inodeId,
    inodeS3Key,
    inputFileName,
    fromMimeType,
    toMimeType,
    thumbOnly,
    appUrl,
  } = JSON.parse(record.body);

  const isBmp = fromMimeType === "image/bmp";

  const resultDetail = {
    inodeId,
    inodeS3Key,
    appUrl,
    timestamp: Date.now(),
  };

  function sendResult() {
    const event = {
      EventBusName: EVENT_BUS_NAME,
      Source: EVENT_SOURCE,
      DetailType: "SharpProcStatus",
      Detail: JSON.stringify(resultDetail),
    };
    return eventBridge.send(new PutEventsCommand({ Entries: [event] }));
  }

  const previewFileExt = MIME_TO_EXT[toMimeType];

  if (!previewFileExt && !thumbOnly) {
    resultDetail.status = "ERROR";
    resultDetail.errorMsg = `Unsupported toMimeType value: ${toMimeType}`;
    await sendResult();
    return;
  }

  try {
    const s3Object = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: inodeS3Key })
    );

    const chunks = [];
    for await (const chunk of s3Object.Body) chunks.push(chunk);
    const inputBuffer = Buffer.concat(chunks);

    const sharpOpt = {
      limitInputPixels: 900_000_000,
    };

    const previewFileName = `preview.${previewFileExt}`;
    const previewMimeType = toMimeType;

    const images = {
      preview: {
        fileName: previewFileName,
        mimeType: previewMimeType,
        contentDispositionFileName: `${inputFileName}.${previewFileName}`,
        height: 500,
        quality: 90,
      },
      thumb: {
        fileName: "thumb.jpeg",
        mimeType: "image/jpeg",
        contentDispositionFileName: `${inputFileName}.thumb.jpeg`,
        height: 150,
        quality: 80,
      },
    };

    let _sharpInst;

    function getSharpInst() {
      if (isBmp) return bmp.sharpFromBmp(inputBuffer, sharpOpt);
      _sharpInst ??= sharp(inputBuffer, sharpOpt);
      return _sharpInst.clone();
    }

    for (const [imageKey, image] of Object.entries(images)) {
      if (thumbOnly && imageKey !== "thumb") {
        continue;
      }

      const sharpInst = await getSharpInst();

      sharpInst
        .rotate()
        .resize({ height: image.height, withoutEnlargement: true })
        .jpeg({ quality: image.quality, mozjpeg: true });

      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `${inodeS3Key}/${image.fileName}`,
          Body: await sharpInst.toBuffer(),
          ContentType: image.mimeType,
          CacheControl: "public, max-age=31536000, immutable",
          ContentDisposition: `inline; filename*=UTF-8''${image.contentDispositionFileName}`,
        })
      );

      resultDetail[imageKey + "FileName"] = image.fileName;
    }

    const metadata = await (await getSharpInst()).metadata();

    resultDetail.status = "COMPLETE";
    resultDetail.width = metadata.width;
    resultDetail.height = metadata.height;

    if (metadata.exif) {
      const exif = exifReader(metadata.exif);
      const dateTimeOriginal = exif.Photo?.DateTimeOriginal;
      const offsetTimeOriginal = exif.Photo?.OffsetTimeOriginal;
      let fixedDateTimeOriginal = dateTimeOriginal;

      if (dateTimeOriginal && offsetTimeOriginal) {
        fixedDateTimeOriginal = new Date(
          dateTimeOriginal.toISOString().replace("Z", offsetTimeOriginal)
        );
      }
      resultDetail.exif = {
        Make: exif.Image?.Make,
        Model: exif.Image?.Model,
        DateTimeOriginal: fixedDateTimeOriginal,
        OffsetTimeOriginal: offsetTimeOriginal,
        GPSLatitude: exif.GPSInfo?.GPSLatitude,
        GPSLongitudeRef: exif.GPSInfo?.GPSLongitudeRef,
        GPSLongitude: exif.GPSInfo?.GPSLongitude,
        GPSAltitudeRef: exif.GPSInfo?.GPSAltitudeRef,
        GPSAltitude: exif.GPSInfo?.GPSAltitude,
        GPSSpeedRef: exif.GPSInfo?.GPSSpeedRef,
        GPSSpeed: exif.GPSInfo?.GPSSpeed,
        GPSImgDirectionRef: exif.GPSInfo?.GPSImgDirectionRef,
        GPSImgDirection: exif.GPSInfo?.GPSImgDirection,
        GPSDestBearingRef: exif.GPSInfo?.GPSDestBearingRef,
        GPSDestBearing: exif.GPSInfo?.GPSDestBearing,
        GPSHPositioningError: exif.GPSInfo?.GPSHPositioningError,
        GPSDateStamp: exif.GPSInfo?.GPSDateStamp,
        GPSTimeStamp: exif.GPSInfo?.GPSTimeStamp,
      };
    }
  } catch (error) {
    resultDetail.status = "ERROR";
    console.error(error);
    throw error;
  } finally {
    if (resultDetail.status !== "ERROR" || isLastReceive) {
      await sendResult();
    }
  }
};
