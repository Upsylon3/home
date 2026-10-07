@echo off
title HomeVault backend - :4600
cd /d "C:\Users\yopip\Documents\Projects\home\apps\homevault-backend"
set "PORT=4600"
set "DATA_DIR="
set "C:\Users\yopip\Documents\Projects\home\apps\homevault-backend\data"
set "HOMECORE_INTERNAL_URL=http://localhost:4000"
npm run dev
