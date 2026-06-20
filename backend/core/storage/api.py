"""
bapX Auto Storage API

Pay-per-GB storage with:
- Real-time quota tracking
- S3-compatible storage (MinIO)
- Usage-based billing
- Soft/hard limits
"""

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Header, Body
from typing import Optional, Dict, Any
from pydantic import BaseModel
import asyncio

from core.utils.logger import logger
from core.config import get_config, Config

router = APIRouter()


class StorageUsage(BaseModel):
    used_bytes: int
    quota_bytes: int
    used_gb: float
    quota_gb: float
    percentage: float
    cost_usd: float


class FileUploadResponse(BaseModel):
    id: str
    path: str
    size_bytes: int
    url: str


@router.get("/usage")
async def get_storage_usage(user_id: str = Header(...)):
    """
    Get user's current storage usage.
    
    Returns real-time usage with cost calculation.
    """
    logger.info(f"Getting storage usage for user {user_id[:8]}...")
    
    # TODO: Fetch actual usage from database
    
    config = get_config()
    free_gb = config.FREE_TIER_GB
    
    usage = StorageUsage(
        used_bytes=0,
        quota_bytes=free_gb * 1024**3,
        used_gb=0.0,
        quota_gb=float(free_gb),
        percentage=0.0,
        cost_usd=0.0
    )
    
    return usage


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = Header(...),
    path: str = Header(...)
):
    """
    Upload a file to storage.
    
    Checks quota before upload and tracks usage for billing.
    """
    logger.info(f"Uploading file: {path} for user {user_id[:8]}...")
    
    # Get file size
    content = await file.read()
    size_bytes = len(content)
    
    # Check quota
    await check_quota(user_id, size_bytes)
    
    # TODO: Upload to MinIO/S3
    # TODO: Track in database
    # TODO: Update billing
    
    return FileUploadResponse(
        id=f"file-{asyncio.get_event_loop().time()}",
        path=path,
        size_bytes=size_bytes,
        url=f"https://storage.bapx.auto/{user_id}/{path}"
    )


@router.delete("/file/{path:path}")
async def delete_file(
    path: str,
    user_id: str = Header(...)
):
    """Delete a file and reclaim storage"""
    logger.info(f"Deleting file: {path} for user {user_id[:8]}...")
    
    # TODO: Delete from storage
    # TODO: Update usage tracking
    # TODO: Adjust billing
    
    return {"status": "success", "path": path}


@router.get("/file/{path:path}")
async def get_file(
    path: str,
    user_id: str = Header(...)
):
    """Get file download URL"""
    # TODO: Generate presigned URL
    
    return {
        "url": f"https://storage.bapx.auto/{user_id}/{path}",
        "expires_in": 3600
    }


@router.post("/quota/check")
async def check_quota_endpoint(
    required_bytes: int = Body(..., embed=True),
    user_id: str = Header(...)
):
    """
    Check if user has enough quota for a file.
    
    Returns quota status and upgrade options if needed.
    """
    config = get_config()
    
    # TODO: Get actual usage
    current_usage = 0
    quota_bytes = config.FREE_TIER_GB * 1024**3
    
    available = quota_bytes - current_usage
    has_quota = available >= required_bytes
    
    return {
        "has_quota": has_quota,
        "available_bytes": available,
        "required_bytes": required_bytes,
        "shortfall_bytes": max(0, required_bytes - available),
        "upgrade_options": {
            "pro": {
                "gb": config.PRO_TIER_GB,
                "price_usd": config.PRO_MONTHLY_PRICE,
                "url": "/billing/upgrade"
            },
            "pay_per_gb": {
                "price_per_gb": config.STORAGE_PRICE_PER_GB,
                "url": "/billing/top-up"
            }
        }
    }


async def check_quota(user_id: str, file_size: int):
    """
    Check quota and raise exception if exceeded.
    """
    config = get_config()
    
    # TODO: Get actual usage from database
    current_usage = 0
    quota_bytes = config.FREE_TIER_GB * 1024**3
    
    if current_usage + file_size > quota_bytes:
        shortfall = (current_usage + file_size) - quota_bytes
        
        raise HTTPException(
            status_code=403,
            detail={
                "error": "quota_exceeded",
                "message": f"Storage quota exceeded. Need {shortfall / 1024**3:.2f} GB more.",
                "current_gb": current_usage / 1024**3,
                "quota_gb": config.FREE_TIER_GB,
                "upgrade_url": "/billing/upgrade"
            }
        )


@router.get("/pricing")
async def get_pricing():
    """Get storage pricing information"""
    config = get_config()
    
    return {
        "free_tier": {
            "storage_gb": config.FREE_TIER_GB,
            "agent_runs_per_month": 100,
            "price_usd": 0
        },
        "pro_tier": {
            "storage_gb": config.PRO_TIER_GB,
            "agent_runs_per_month": "unlimited",
            "price_usd": config.PRO_MONTHLY_PRICE,
            "features": [
                "Priority support",
                "Advanced models (o1, Claude Opus)",
                "Faster sandbox startup",
                "Analytics dashboard"
            ]
        },
        "pay_per_gb": {
            "price_per_gb_per_month": config.STORAGE_PRICE_PER_GB,
            "minimum": 0,
            "billing": "monthly"
        }
    }
