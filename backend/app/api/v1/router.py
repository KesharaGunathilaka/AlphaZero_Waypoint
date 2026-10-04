from fastapi import APIRouter

from app.modules.auth.router import router as auth_router
from app.modules.dispatch.router import router as dispatch_router
from app.modules.field.router import router as field_router
from app.modules.store.router import router as store_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(field_router)
router.include_router(store_router)
router.include_router(dispatch_router)
