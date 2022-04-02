import {
  Stack,
  StackProps,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
  aws_ses as ses,
  aws_iam as iam,
  custom_resources,
  aws_lambda as lambda,
  aws_dynamodb as ddb,
  CfnParameter,
  CfnOutput,
  RemovalPolicy,
} from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as fs from "fs";

export class SesEventRecorderStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    let retentionMap = new Map<string, RetentionDays>();
    retentionMap.set("THREE_DAYS", RetentionDays.THREE_DAYS);
    retentionMap.set("FIVE_DAYS", RetentionDays.FIVE_DAYS);
    retentionMap.set("ONE_WEEK", RetentionDays.ONE_WEEK);
    retentionMap.set("TWO_WEEKS", RetentionDays.TWO_WEEKS);
    retentionMap.set("ONE_MONTH", RetentionDays.ONE_MONTH);
    retentionMap.set("TWO_MONTHS", RetentionDays.TWO_MONTHS);
    retentionMap.set("THREE_MONTHS", RetentionDays.THREE_MONTHS);
    retentionMap.set("FOUR_MONTHS", RetentionDays.FOUR_MONTHS);
    retentionMap.set("FIVE_MONTHS", RetentionDays.FIVE_MONTHS);
    retentionMap.set("SIX_MONTHS", RetentionDays.SIX_MONTHS);
    retentionMap.set("ONE_YEAR", RetentionDays.ONE_YEAR);
    retentionMap.set("THIRTEEN_MONTHS", RetentionDays.THIRTEEN_MONTHS);
    retentionMap.set("EIGHTEEN_MONTHS", RetentionDays.EIGHTEEN_MONTHS);
    retentionMap.set("TWO_YEARS", RetentionDays.TWO_YEARS);
    retentionMap.set("FIVE_YEARS", RetentionDays.FIVE_YEARS);
    retentionMap.set("TEN_YEARS", RetentionDays.TEN_YEARS);
    retentionMap.set("INFINITE", RetentionDays.INFINITE);

    // parameters
    const eventTypes = new CfnParameter(this, "EventTypes", {
      type: "CommaDelimitedList",
      description:
        "Event types. See https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_EventDestinationDefinition.html#SES-Type-EventDestinationDefinition-MatchingEventTypes",
      default: "REJECT,BOUNCE,COMPLAINT",
    }).valueAsList;
    const storageType = new CfnParameter(this, "StorageType", {
      type: "String",
      allowedValues: ["DynamoDB", "CloudWatch Logs"],
      description: "Where to store your events?",
      default: "CloudWatch Logs",
    }).valueAsString;
    const logTTL = new CfnParameter(this, "CloudWatchLogRetention", {
      type: "String",
      description: "How long to keep your logs in CloudWatch Logs?",
      allowedValues: Array.from(retentionMap.keys()),
      default: "ONE_WEEK",
    }).valueAsString;
    const ddbTTL = new CfnParameter(this, "DynamoDBTTL", {
      type: "Number",
      description:
        "How many seconds to keep those event logs in DynamoDB? Ignore this if you choose CloudWatch Logs as the storage.",
      default: 60 * 60 * 24 * 7, // 7 days
    }).valueAsString;

    let lambdaFunction: lambda.Function;
    if (storageType == "DynamoDB") {
      const eventTable = new ddb.Table(this, "EventTable", {
        partitionKey: { name: "destination", type: ddb.AttributeType.STRING },
        sortKey: { name: "timestamp", type: ddb.AttributeType.STRING },
        timeToLiveAttribute: "ttl",
        removalPolicy: RemovalPolicy.DESTROY,
      });

      lambdaFunction = new lambda.Function(this, "SnsToDynamoDB", {
        code: lambda.Code.fromInline(
          fs.readFileSync("./assets/handler.js").toString()
        ),
        runtime: lambda.Runtime.NODEJS_12_X,
        handler: "index.handler",
        environment: {
          TableName: eventTable.tableName,
          TTL: ddbTTL,
        },
        logRetention: retentionMap.get(logTTL),
      });
      eventTable.grantWriteData(lambdaFunction);

      new CfnOutput(this, "DynamoDBTableName", {
        value: eventTable.tableName,
        description: "DynamoDB table where the events are stored.",
      });
    } else {
      lambdaFunction = new lambda.Function(this, "SnsToCloudWatchLogs", {
        code: lambda.Code.fromInline(
          fs.readFileSync("./assets/handler.js").toString()
        ),
        runtime: lambda.Runtime.NODEJS_12_X,
        handler: "index.handler",
        logRetention: retentionMap.get(logTTL),
      });
      new CfnOutput(this, "CloudWatchLogGroupName", {
        value: lambdaFunction.logGroup.logGroupName,
        description: "CloudWatch LogGroup where the events are stored.",
      });
    }

    const topic = new sns.Topic(this, "SesEventPublisherTopic", {});
    topic.addSubscription(new subscriptions.LambdaSubscription(lambdaFunction));

    const ConfigurationSetName = `${this.stackName}-SnsEventPublishingConfigurationSet`;
    const EventDestinationName = `${this.stackName}-SnsEventPublishingDestination`;
    let configSet = new ses.CfnConfigurationSet(this, "configSet", {
      name: ConfigurationSetName,
    });
    let emailDest = new custom_resources.AwsCustomResource(
      this,
      `EmailDestination`,
      {
        policy: {
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "ses:UpdateConfigurationSetEventDestination",
                "ses:CreateConfigurationSetEventDestination",
                "ses:DeleteConfigurationSetEventDestination",
              ],
              resources: [
                `arn:${this.partition}:ses:${this.region}:${this.account}:configuration-set/${ConfigurationSetName}`,
              ],
            }),
          ],
        },

        onCreate: {
          service: "SESV2",
          action: "createConfigurationSetEventDestination",
          parameters: {
            ConfigurationSetName,
            EventDestinationName,
            EventDestination: {
              Enabled: true,
              MatchingEventTypes: eventTypes,
              SnsDestination: {
                TopicArn: topic.topicArn,
              },
            },
          },
          physicalResourceId: custom_resources.PhysicalResourceId.of(
            topic.topicArn
          ),
        },

        onUpdate: {
          service: "SESV2",
          action: "updateConfigurationSetEventDestination",
          parameters: {
            ConfigurationSetName,
            EventDestinationName,
            EventDestination: {
              Enabled: true,
              MatchingEventTypes: eventTypes,
              SnsDestination: {
                TopicArn: topic.topicArn,
              },
            },
          },
          physicalResourceId: custom_resources.PhysicalResourceId.of(
            topic.topicArn
          ),
        },

        onDelete: {
          service: "SESV2",
          action: "deleteConfigurationSetEventDestination",
          parameters: {
            ConfigurationSetName,
            EventDestinationName,
          },
          physicalResourceId: custom_resources.PhysicalResourceId.of(
            topic.topicArn
          ),
        },
      }
    );
    emailDest.node.addDependency(configSet);

    new CfnOutput(this, "ConfigurationSetName", {
      value: ConfigurationSetName,
      description:
        "Set this configuration set as the default configuration set for your identity.",
    });
  }
}
