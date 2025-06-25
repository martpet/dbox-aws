const fs = require("fs");
const childProcess = require("child_process");
const crypto = require("crypto");
const { pipeline } = require("stream");
const { promisify } = require("util");
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const {
  EventBridgeClient,
  PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");

const s3 = new S3Client({ region: process.env.AWS_REGION });
const eventBridge = new EventBridgeClient({ region: process.env.AWS_REGION });
const pipelineAsync = promisify(pipeline);

const MIME_TO_EXT = {
  "application/pdf": "pdf",
  "image/png": "png",
};

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
  const { inodeId, inodeS3Key, inputFileName, toMimeType, appUrl } = JSON.parse(
    record.body
  );

  const resultDetail = {
    inodeId,
    inodeS3Key,
    appUrl,
  };

  function sendResult() {
    const event = {
      EventBusName: EVENT_BUS_NAME,
      Source: EVENT_SOURCE,
      DetailType: "LibreProcStatus",
      Detail: JSON.stringify(resultDetail),
    };
    return eventBridge.send(new PutEventsCommand({ Entries: [event] }));
  }

  const previewFileExt = MIME_TO_EXT[toMimeType];

  if (!previewFileExt) {
    resultDetail.status = "ERROR";
    resultDetail.errorMsg = `Unsupported mimeType value: ${toMimeType}`;
    await sendResult();
    return;
  }

  const previewFileName = `preview.${previewFileExt}`;
  const previewMimeType = toMimeType;
  const contentDispositionFileName = `${inputFileName}.${previewFileExt}`;

  const _id = crypto.randomUUID();
  const INPUT_PATH = `/tmp/${_id}`;
  const OUTPUT_PATH = `/tmp/${_id}.${previewFileExt}`;

  try {
    const s3Command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: inodeS3Key,
    });

    const s3Object = await s3.send(s3Command);
    const writeStream = fs.createWriteStream(INPUT_PATH);

    await pipelineAsync(s3Object.Body, writeStream);

    childProcess.execSync(
      `libreoffice7.6 --headless --convert-to ${previewFileExt} ${INPUT_PATH} --outdir /tmp`
    );

    const outputBuffer = fs.readFileSync(OUTPUT_PATH);

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${inodeS3Key}/${previewFileName}`,
        Body: outputBuffer,
        ContentType: previewMimeType,
        CacheControl: "public, max-age=31536000, immutable",
        ContentDisposition: `inline; filename*=UTF-8''${contentDispositionFileName}`,
      })
    );

    resultDetail.status = "COMPLETE";
    resultDetail.previewFileName = previewFileName;
  } catch (error) {
    resultDetail.status = "ERROR";
    console.error(error);
    throw error;
  } finally {
    if (fs.existsSync(INPUT_PATH)) fs.unlinkSync(INPUT_PATH);
    if (fs.existsSync(OUTPUT_PATH)) fs.unlinkSync(OUTPUT_PATH);
    if (resultDetail.status !== "ERROR" || isLastReceive) {
      await sendResult();
    }
  }
};
