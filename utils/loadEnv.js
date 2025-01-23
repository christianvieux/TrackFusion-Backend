import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

export async function initializeEnvironment() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (!process.env.AWS_SECRETS_ARN) {
      throw new Error('AWS_SECRETS_ARN environment variable is required in production');
    }

    const client = new SecretsManagerClient({ 
      region: 'us-east-1'
    });

    try {
      const command = new GetSecretValueCommand({
        SecretId: process.env.AWS_SECRETS_ARN
      });
      
      const response = await client.send(command);
      const secrets = JSON.parse(response.SecretString);
      
      // Log available secret keys without their values
      console.log('Available secret keys:', Object.keys(secrets));
      
      // For development/debugging only - use with caution
      if (process.env.DEBUG_SECRETS === 'true') {
        console.log('Secret values (DEBUG MODE):', 
          Object.fromEntries(
            Object.entries(secrets).map(([key, value]) => [
              key, 
              // Mask sensitive values
              key.toLowerCase().includes('key') || 
              key.toLowerCase().includes('secret') || 
              key.toLowerCase().includes('password') 
                ? '****' 
                : value
            ])
          )
        );
      }

      Object.entries(secrets).forEach(([key, value]) => {
        process.env[key] = value;
      });
      
      console.log('Production environment variables loaded from AWS Secrets Manager');
    } catch (error) {
      console.error('Error loading production environment variables:', error);
      throw error;
    }
  } else {
    console.log('Development environment variables loaded from .env file');
    // Optional: Log available .env keys in development
    console.log("Available .env keys in 'development' :", Object.keys(process.env));
  }
}