const csv = require("csv-parser");

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
  const { inodeId, inodeS3Key, inputFileName, toMimeType, appUrl } = JSON.parse(
    record.body
  );

  const previewFileExt = MIME_TO_EXT[toMimeType];

  const resultDetail = {
    inodeId,
    inodeS3Key,
    appUrl,
  };

  function sendResult() {
    const event = {
      EventBusName: EVENT_BUS_NAME,
      Source: EVENT_SOURCE,
      DetailType: "CsvProcStatus",
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

    const rows = await new Promise((resolve, reject) => {
      const results = [];
      s3Object.Body.pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", () => resolve(results))
        .on("error", (err) => reject(err));
    });

    if (rows.length === 0) {
      resultDetail.status = "ERROR";
      resultDetail.errorMsg = "CSV is empty";
      await sendResult();
      return;
    }

    const html = createHtml(rows);

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

function createHtml(rows) {
  const headers = Object.keys(rows[0]);

  let thead = "";
  let tbody = "";

  for (const h of headers) {
    thead += `<th>${h}</th>`;
  }

  for (const row of rows) {
    tbody += "<tr>";
    for (const h of headers) tbody += `<td>${row[h]}</td>`;
    tbody += "</tr>\n";
  }

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="dark light" />
        <style>
          :root {          
            --border-grey: lightGray;
            --bg-light: #eee;
            
            @media (prefers-color-scheme: dark) {
              --border-grey: oklch(from Canvas calc(l + 0.15) c h);
              --bg-light: oklch(from Canvas calc(l + 0.05) c h);
            }
          }
          body {
            font-family: system-ui;
            font-size: 14px
          }
          table {
            border-collapse: collapse;
          }
          th {
            text-align: left;
            background: var(--bg-light);
          }
          th, td {
            padding: 0.4em 0.5em;
            border: 1px solid var(--border-grey);
          }
        </style>
      </head>
      <body>
        <table>
          <thead>
            ${thead}
          </thead>
          <tbody>
            ${tbody}
          </tbody>
        </table>
      </body>
    </html>
  `;
}
