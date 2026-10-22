# Uses your existing Gemini CLI installation and authentication.
$ErrorActionPreference = 'Stop'
& gemini @args
exit $LASTEXITCODE
