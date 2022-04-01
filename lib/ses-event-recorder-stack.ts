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

    const eventTTL = new CfnParameter(this, "EventTTL", {
      type: "Number",
      description: "How many seconds to keep those event log in DynamoDB.",
      default: 60 * 60 * 24 * 7, // 7 days
    }).valueAsString;
    const eventTypes = new CfnParameter(this, "EventTypes", {
      type: "CommaDelimitedList",
      description:
        "Event types, separated by a comma. See https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_EventDestinationDefinition.html#SES-Type-EventDestinationDefinition-MatchingEventTypes",
      default: "REJECT,BOUNCE,COMPLAINT",
    }).valueAsList;

    const eventTable = new ddb.Table(this, "EventTable", {
      partitionKey: { name: "destination", type: ddb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: ddb.AttributeType.STRING },
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const snsToDdbFunction = new lambda.Function(this, "SnsToDynamoDB", {
      code: lambda.Code.fromInline(
        fs.readFileSync("./assets/handler.js").toString()
      ),
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: "index.handler",
      environment: {
        TableName: eventTable.tableName,
        TTL: eventTTL,
      },
      logRetention: RetentionDays.ONE_DAY,
    });
    eventTable.grantWriteData(snsToDdbFunction);

    const topic = new sns.Topic(this, "SesEventPublisherTopic", {});
    topic.addSubscription(
      new subscriptions.LambdaSubscription(snsToDdbFunction)
    );

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
