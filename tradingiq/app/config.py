from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    azure_existing_aiproject_endpoint: str
    azure_existing_agent_name: str
    azure_existing_agent_version: str
    run_timeout_seconds: int = 180

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="allow")


settings = Settings()
