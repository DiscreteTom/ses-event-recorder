const aws = require("aws-sdk");

const ddb = new aws.DynamoDB.DocumentClient();
const TableName = process.env.TableName;
const TTL = parseInt(process.env.TTL);

exports.handler = async function (event, context) {
  // log to cloudwatch logs
  console.log(event.Records[0].Sns.Message);

  // store in dynamodb
  if (TableName) {
    let timestamp = event.Records[0].Sns.Timestamp;
    let message = JSON.parse(event.Records[0].Sns.Message);

    let promises = [];
    message.mail.destination.map((d) => {
      let item = JSON.parse(event.Records[0].Sns.Message);
      item.destination = d;
      item.timestamp = timestamp;
      item.ttl = Math.floor(Date.now() / 1000) + TTL;

      promises.push(
        new Promise((resolve, reject) => {
          ddb.put({ TableName, Item: item }, function (err, data) {
            if (err) {
              reject(err);
            } else {
              resolve(data);
            }
          });
        })
      );
    });

    return Promise.all(promises);
  }
};
