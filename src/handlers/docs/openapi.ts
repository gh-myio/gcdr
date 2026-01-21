import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import * as fs from 'fs';
import * as path from 'path';

let cachedSpec: string | null = null;

// Simple YAML to JSON converter for basic OpenAPI specs
function parseYaml(yamlContent: string): object {
  // Use dynamic import for yamljs to avoid type issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const yaml = require('yamljs');
  return yaml.parse(yamlContent);
}

export const handler: APIGatewayProxyHandler = async (): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  };

  try {
    if (!cachedSpec) {
      // Try multiple paths for the OpenAPI spec
      const possiblePaths = [
        path.join(__dirname, '../../../docs/openapi.yaml'),
        path.join(__dirname, '../../docs/openapi.yaml'),
        path.join(process.cwd(), 'docs/openapi.yaml'),
        '/var/task/docs/openapi.yaml',
      ];

      let yamlContent: string | null = null;

      for (const filePath of possiblePaths) {
        try {
          if (fs.existsSync(filePath)) {
            yamlContent = fs.readFileSync(filePath, 'utf8');
            break;
          }
        } catch {
          continue;
        }
      }

      if (!yamlContent) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            success: false,
            error: {
              code: 'SPEC_NOT_FOUND',
              message: 'OpenAPI specification file not found',
            },
          }),
        };
      }

      const spec = parseYaml(yamlContent);
      cachedSpec = JSON.stringify(spec);
    }

    return {
      statusCode: 200,
      headers,
      body: cachedSpec,
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Failed to load OpenAPI spec',
        },
      }),
    };
  }
};
