export interface AppConfig {
  tableName: string;
  auditTableName: string;
  stage: string;
  region: string;
  isOffline: boolean;
}

class ConfigSingleton {
  private static instance: AppConfig | null = null;

  public static getInstance(): AppConfig {
    if (!ConfigSingleton.instance) {
      ConfigSingleton.instance = {
        tableName: process.env.DYNAMODB_TABLE || 'gcdr-api-dev',
        auditTableName: process.env.AUDIT_TABLE || 'gcdr-api-dev-audit',
        stage: process.env.STAGE || 'dev',
        region: process.env.AWS_REGION || 'us-east-1',
        isOffline: process.env.IS_OFFLINE === 'true',
      };
    }
    return ConfigSingleton.instance;
  }

  public static reset(): void {
    ConfigSingleton.instance = null;
  }
}

export const config = ConfigSingleton.getInstance();
export { ConfigSingleton };
