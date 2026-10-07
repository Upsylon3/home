@echo off
title HomeCloud backend - :4500
cd /d "C:\Users\yopip\Documents\Projects\home\apps\homecloud-backend"
set "PORT=4500"
set "DATA_DIR="
set "C:\Users\yopip\Documents\Projects\home\apps\homecloud-backend\data"
set "CORS_ORIGIN=http://localhost:5174"
set "HOMECORE_INTERNAL_URL=http://localhost:4000"
set "HOMECORE_INTERNAL_SECRET="
set "home-dev-only-change-me"
npm run dev
