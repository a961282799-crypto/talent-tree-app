@echo off
chcp 65001 >nul
title 推送到 GitHub
cd /d "%~dp0"

rem ---- 检查 git、npm 和分支 ----
where git >nul 2>nul
if errorlevel 1 goto :nogit
where npm >nul 2>nul
if errorlevel 1 goto :nonpm
set "BRANCH="
for /f "delims=" %%b in ('git branch --show-current') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="main" goto :notmain

rem ---- 清掉以前留下的无用文件 ----
del /q ".git\stale-*" >nul 2>nul
del /q ".git\v120.bundle" >nul 2>nul

rem ---- npm：装依赖、测试、打包、同步到安卓工程（和 GitHub 上自动打包的步骤一样）----
echo [1/5] 安装依赖……
call npm install --no-audit --no-fund
if errorlevel 1 goto :npmfail
echo.
echo [2/5] 运行测试……
call npm test --silent
if errorlevel 1 goto :testfail
echo.
echo [3/5] 打包网页……
call npm run build
if errorlevel 1 goto :buildfail
echo.
if not exist "android" goto :commit
echo [4/5] 同步到安卓工程……
call npx cap sync android
if errorlevel 1 goto :syncfail
echo.

:commit
echo [5/5] 提交并推送……
git add -A
git diff --cached --quiet
if not errorlevel 1 goto :push
echo 有这些改动：
git status --short
echo.
set "MSG="
set /p "MSG=这次改了什么？（直接回车就用日期当说明）: "
if not defined MSG for /f "delims=" %%d in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm'"') do set "MSG=更新 %%d"
git commit -q -m "%MSG%"
if errorlevel 1 goto :commitfail
echo 已提交：%MSG%
echo.

:push
git push origin main
if errorlevel 1 goto :pushfail
echo.
echo ✅ 推送成功。
goto :end

:nogit
echo 没找到 git。请先安装 Git for Windows：https://git-scm.com/download/win
goto :end

:nonpm
echo 没找到 npm。请先安装 Node.js 22 或更高版本：https://nodejs.org/
goto :end

:notmain
echo 现在在「%BRANCH%」分支，不是 main，为安全起见没有推送。
goto :end

:npmfail
echo.
echo ❌ 安装依赖失败，没有提交也没有推送。多半是网络问题，换个网络或稍后再双击一次。
goto :end

:testfail
echo.
echo ❌ 测试没通过，没有提交也没有推送。把上面的报错发给 Claude 看看。
goto :end

:buildfail
echo.
echo ❌ 打包失败，没有提交也没有推送。把上面的报错发给 Claude 看看。
goto :end

:syncfail
echo.
echo ❌ 同步到安卓工程失败，没有提交也没有推送。把上面的报错发给 Claude 看看。
goto :end

:commitfail
echo ❌ 提交失败，看上面的提示。
goto :end

:pushfail
echo.
echo ❌ 推送失败。常见原因：
echo   1. 弹出了 GitHub 登录窗口但没登录：再双击一次，按提示在浏览器里授权。
echo   2. GitHub 上有你电脑上没有的新提交：先运行 git pull --rebase origin main，再双击一次。
echo   其他情况把上面的报错发给 Claude。

:end
echo.
pause
