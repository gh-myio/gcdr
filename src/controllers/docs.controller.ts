import { Router, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const router = Router();

// Load OpenAPI specification
let swaggerDocument: object;

try {
  const openApiPath = path.join(__dirname, '../../docs/openapi.yaml');
  const fileContents = fs.readFileSync(openApiPath, 'utf8');
  swaggerDocument = yaml.load(fileContents) as object;
} catch (error) {
  console.warn('OpenAPI spec not found, using minimal spec');
  swaggerDocument = {
    openapi: '3.0.3',
    info: {
      title: 'GCDR API',
      version: '1.0.0',
      description: 'Global Central Data Registry API',
    },
    servers: [
      { url: 'http://localhost:3015', description: 'Local Development' },
    ],
    paths: {},
  };
}

// Swagger UI options
const swaggerOptions: swaggerUi.SwaggerUiOptions = {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'GCDR API Documentation',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
  },
};

// Serve Swagger UI
router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(swaggerDocument, swaggerOptions));

// Serve raw OpenAPI JSON
router.get('/openapi.json', (req: Request, res: Response) => {
  res.json(swaggerDocument);
});

export default router;
