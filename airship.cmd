@echo off
:: The workspace's own airship, in shorthand — the Windows half of ./airship.
::
:: `make` is not available here (see CONTRIBUTING.md § On Windows), so this is
:: the supported way to run the CLI built from this tree. It is a pure
:: passthrough, and it rebuilds when the inlined workspace packages change,
:: exactly like the bash script does.
::
::   airship --target 3000 --cwd ..\my-app
::   airship doctor
::
:: %* rather than %1 %2 ...: it forwards the command line with its original
:: quoting intact, which `airship --exec "pnpm dev"` depends on. %~dp0 is this
:: file's own directory, with a trailing backslash, so nothing here depends on
:: the working directory — which must reach the CLI untouched.
node "%~dp0scripts\airship-run.mjs" %*
:: Explicit, so the CLI's exit codes (2 usage, 127 unknown command) survive
:: being called from another script.
exit /b %errorlevel%
