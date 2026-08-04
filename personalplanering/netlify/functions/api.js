const serverless = require('serverless-http');
const app = require('../../expressApp');

exports.handler = serverless(app);
