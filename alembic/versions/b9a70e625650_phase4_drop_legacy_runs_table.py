"""phase4 drop legacy runs table

Revision ID: b9a70e625650
Revises: eceb2358f070
Create Date: 2026-07-04 12:41:21.728010

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9a70e625650'
down_revision: Union[str, None] = 'eceb2358f070'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Prune the leftover transform-era skeleton table. Guarded so it is a no-op
    # if the table was never created on a given DB.
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "runs" in insp.get_table_names():
        op.drop_table("runs")


def downgrade() -> None:
    op.create_table(
        "runs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("input_text", sa.Text(), nullable=True),
        sa.Column("output_text", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
