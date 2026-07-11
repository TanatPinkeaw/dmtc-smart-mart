const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'POS Coop API',
      version: '1.0.0',
      description: 'API documentation for the College Cooperative POS System',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
  },
  apis: ['./server.js'], // อ่าน comment จากไฟล์ server.js
};

const specs = swaggerJsdoc(options);

module.exports = { swaggerUi, specs };