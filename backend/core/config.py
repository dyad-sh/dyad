"""
bapX Auto Configuration

Environment-based configuration for development, staging, and production.
"""

import os
from enum import Enum
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings


class EnvMode(str, Enum):
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class Config(BaseSettings):
    """Application configuration loaded from environment variables"""
    
    # Environment
    ENV_MODE: EnvMode = Field(default=EnvMode.DEVELOPMENT)
    PORT: int = Field(default=8000)
    
    # Supabase
    SUPABASE_URL: str = Field(default="http://localhost:54321")
    SUPABASE_ANON_KEY: str = Field(default="your-anon-key")
    SUPABASE_SERVICE_KEY: str = Field(default="your-service-key")
    
    # Redis
    REDIS_HOST: str = Field(default="localhost")
    REDIS_PORT: int = Field(default=6379)
    REDIS_PASSWORD: Optional[str] = Field(default=None)
    REDIS_SSL: bool = Field(default=False)
    
    # Storage (MinIO/S3)
    STORAGE_ENDPOINT: str = Field(default="localhost:9000")
    STORAGE_ACCESS_KEY: str = Field(default="minioadmin")
    STORAGE_SECRET_KEY: str = Field(default="minioadmin")
    STORAGE_BUCKET: str = Field(default="bapx-auto")
    
    # AI Gateway
    DEFAULT_MODEL: str = Field(default="openai/gpt-4o")
    MAX_TOKENS: int = Field(default=4096)
    TEMPERATURE: float = Field(default=0.7)
    
    # Sandbox
    SANDBOX_MODE: str = Field(default="docker")  # "docker", "webcontainer", "wasm"
    SANDBOX_TIMEOUT: int = Field(default=300)  # 5 minutes
    SANDBOX_MEMORY_LIMIT: str = Field(default="512m")
    
    # GraphRAG
    EMBEDDING_MODEL: str = Field(default="text-embedding-3-small")
    VECTOR_DIMENSION: int = Field(default=1536)
    
    # Billing
    STORAGE_PRICE_PER_GB: float = Field(default=0.02)  # $0.02/GB
    FREE_TIER_GB: int = Field(default=1)
    PRO_TIER_GB: int = Field(default=10)
    PRO_MONTHLY_PRICE: float = Field(default=10.00)
    
    # Security
    JWT_SECRET: str = Field(default="change-me-in-production")
    ENCRYPTION_KEY: str = Field(default="change-me-in-production")
    
    # Monitoring
    ENABLE_SENTRY: bool = Field(default=False)
    SENTRY_DSN: Optional[str] = Field(default=None)
    ENABLE_PROMETHEUS: bool = Field(default=True)
    
    class Config:
        env_file = ".env"
        case_sensitive = False


# Global config instance
config = Config()


def get_config() -> Config:
    """Get global config instance"""
    return config
