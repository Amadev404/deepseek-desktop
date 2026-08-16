!macro customInstall
  nsExec::Exec /TIMEOUT=240000 `"$INSTDIR\DeepSeek Desktop.exe" --prewarm`
  Pop $0
!macroend
