# SES Event Recorder

Publish AWS SES events to AWS DynamoDB table so you can see the delivery details of you email.

## Architecture

![arch](./img/arch.png)

## Prerequisites

- [npm](https://www.npmjs.com/) is installed.
- AWS credentials are configured.

## Deploy

```bash
# install aws cdk
npm install -g aws-cdk

# download source code
git clone https://github.com/DiscreteTom/ses-event-recorder.git
cd ses-event-recorder

# install dependencies
npm install

# prepare cdk environment
cdk bootstrap

# deploy this project
cdk deploy
```

## Clean Up

```bash
cdk destroy
```
