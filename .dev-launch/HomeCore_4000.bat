@echo off
title HomeCore - :4000
cd /d "C:\Users\yopip\Documents\Projects\home\homecore"
set "PORT=4000"
set "DATA_DIR="
set "C:\Users\yopip\Documents\Projects\home\homecore\data"
set "CORS_ORIGIN=http://localhost:5174"
set "JWT_SECRET="
set "home-dev-only-change-me"
set "HOMECORE_INTERNAL_SECRET="
set "home-dev-only-change-me"
set "HOMECLOUD_FRONTEND_URL=http://localhost:5173/"
set "HOMEMEDIA_FRONTEND_URL=http://localhost:5175/"
set "HOMENOTES_FRONTEND_URL=http://localhost:5176/"
set "HOMESYNC_INFO_URL=http://localhost:4300/"
set "HOMEVAULT_FRONTEND_URL=http://localhost:5177/"
npm run dev
