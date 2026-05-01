import os


class Settings:
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://purepedal_user:purepedal_pass@localhost:5432/purepedal_db",
    )
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")
    WAQI_API_TOKEN: str = os.getenv("WAQI_API_TOKEN", "")
    AQI_SAMPLE_INTERVAL_M: int = 500
    AQI_CACHE_TTL_S: int = 1800  # 30 minutes


settings = Settings()
