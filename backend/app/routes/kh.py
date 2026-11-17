"""Knowledge Hub connection: status, device sign-in (connect and poll) and disconnect."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.auth.current import CurrentUser
from app.kh.service import (
    SIGN_IN_DID_NOT_ANSWER,
    KhConflict,
    KhService,
    KhSignInUnavailable,
    PendingView,
    PollView,
    StatusView,
)
from app.routes.guard import require_app_header

router = APIRouter(prefix="/api/kh", tags=["kh"])
guarded = [Depends(require_app_header)]
NOT_SET_UP = "The Knowledge Hub connector is not set up on this server"


def kh_of(request: Request) -> KhService:
    service: KhService = request.app.state.kh
    return service


def available_kh(request: Request) -> KhService:
    service = kh_of(request)
    if not service.available:
        raise HTTPException(status_code=404, detail=NOT_SET_UP)
    return service


@router.get("")
def get_status(request: Request, user: CurrentUser) -> StatusView:
    return kh_of(request).status(user.id)


@router.post("/connect", dependencies=guarded)
def connect(request: Request, user: CurrentUser) -> PendingView:
    service = available_kh(request)
    try:
        return service.connect(user.id)
    except KhConflict:
        raise HTTPException(
            status_code=409, detail="Already connected to Knowledge Hub; disconnect first"
        ) from None
    except KhSignInUnavailable:
        raise HTTPException(status_code=502, detail=SIGN_IN_DID_NOT_ANSWER) from None


@router.post("/connect/poll", dependencies=guarded)
def poll(request: Request, user: CurrentUser) -> PollView:
    result = available_kh(request).poll(user.id)
    if result is None:
        raise HTTPException(status_code=404, detail="no sign-in in progress")
    return result


@router.delete("", status_code=204, dependencies=guarded)
def disconnect(request: Request, user: CurrentUser) -> Response:
    available_kh(request).disconnect(user.id)
    return Response(status_code=204)
