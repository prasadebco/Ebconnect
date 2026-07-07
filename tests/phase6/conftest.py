"""Phase-6 fixtures. Reuses the root conftest's isolated per-test SQLite file and
adds a `restart` helper that disposes the engine and rebinds a fresh
engine/session-factory to the SAME file — simulating a server restart so we can
assert pinned tiles persist across restarts (mirrors tests/phase2)."""
import pytest


@pytest.fixture
def restart(tmp_path, monkeypatch):
    def _do():
        import db.session as sm
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from fastapi.testclient import TestClient
        from api import app

        if sm._engine is not None:
            sm._engine.dispose()
        engine = create_engine(f"sqlite:///{tmp_path}/test.db")
        factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        monkeypatch.setattr(sm, "_engine", engine)
        monkeypatch.setattr(sm, "_SessionLocal", factory)
        return TestClient(app)

    return _do
