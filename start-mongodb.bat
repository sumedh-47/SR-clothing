@echo off
echo Enabling and Starting MongoDB...
sc config MongoDB start= auto
net start MongoDB
echo.
echo Done! You can now close this window.
pause

