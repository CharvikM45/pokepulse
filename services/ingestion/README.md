# Inventory worker

`pnpm worker:ingestion --schedule` dispatches permitted due checks; `pnpm worker:ingestion` drains a bounded batch. Supply server environment variables and reviewed adapters in run.ts. No live retailer adapter is registered. See docs/runbooks/operations.md.
