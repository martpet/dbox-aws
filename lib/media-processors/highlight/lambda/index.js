const hljs = require("highlight.js");

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

const MIME_TO_EXT = {
  "text/html": "html",
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
  const { inodeId, inodeS3Key, inputFileName, toMimeType, appUrl, codeLang } =
    JSON.parse(record.body);

  const previewFileExt = MIME_TO_EXT[toMimeType];
  const cssUrl = `${appUrl}/assets/inodes/code_preview_iframe.css`;

  const resultDetail = {
    inodeId,
    inodeS3Key,
    appUrl,
  };

  function sendResult() {
    const event = {
      EventBusName: EVENT_BUS_NAME,
      Source: EVENT_SOURCE,
      DetailType: "HighlightProcStatus",
      Detail: JSON.stringify(resultDetail),
    };
    return eventBridge.send(new PutEventsCommand({ Entries: [event] }));
  }

  if (!previewFileExt) {
    resultDetail.status = "ERROR";
    resultDetail.errorMsg = `Unsupported toMimeType value: ${toMimeType}`;
    await sendResult();
    return;
  }

  const previewFileName = `preview.${previewFileExt}`;
  const previewMimeType = toMimeType;
  const contentDispositionFileName = `${inputFileName}.${previewFileExt}`;

  try {
    const s3Object = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: inodeS3Key })
    );

    const chunks = [];
    for await (const chunk of s3Object.Body) chunks.push(chunk);
    const original = Buffer.concat(chunks).toString();

    let highlighted;

    console.log("codeLang", codeLang);

    if (codeLang === "auto") {
      highlighted = hljs.highlightAuto(original).value;
    } else {
      hljs.registerLanguage(
        codeLang,
        require(`highlight.js/lib/languages/${codeLang}`)
      );
      highlighted = hljs.highlight(original, { language: codeLang }).value;
    }

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta name="color-scheme" content="dark light" />
          <link rel="stylesheet" href="${cssUrl}" />
        </head>
        <body>
          <pre><code class="hljs language-${codeLang}">${highlighted}</code></pre>
        </body>
      </html>
  `;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${inodeS3Key}/preview.html`,
        Body: html,
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
    if (resultDetail.status !== "ERROR" || isLastReceive) {
      await sendResult();
    }
  }
};
