@echo off
title HomeNotes backend - :4400
cd /d "C:\Users\yopip\Documents\Projects\home\apps\homenotes-backend"
set "PORT=4400"
set "DATA_DIR="
set "C:\Users\yopip\Documents\Projects\home\apps\homenotes-backend\data"
set "HOMECORE_INTERNAL_URL=http://localhost:4000"
set "HOMECLOUD_BACKEND_INTERNAL_URL=http://localhost:4500"
set "HOMECORE_INTERNAL_SECRET="
set "home-dev-only-change-me"
npm run dev
