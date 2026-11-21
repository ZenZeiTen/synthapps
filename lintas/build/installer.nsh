; Registers Lintas with Windows as a web browser, the way Chrome, Edge and Firefox do, so it
; is offered in Settings > Default apps for HTTP, HTTPS and web files. Windows 10 and 11 let
; only the user pick the default; the installer never changes it.
;
; Commands use `-- "%1"` so a link can never be read as a command-line switch.
; SHCTX is HKCU for a per-user install and HKLM for an all-users install.

!define LINTAS_CLIENT "Software\Clients\StartMenuInternet\Lintas"
!define LINTAS_EXE "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

!macro lintasProgId PROGID DESC
  WriteRegStr SHCTX "Software\Classes\${PROGID}" "" "${DESC}"
  WriteRegStr SHCTX "Software\Classes\${PROGID}" "FriendlyTypeName" "${DESC}"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\Application" "ApplicationName" "Lintas"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\Application" "ApplicationIcon" "${LINTAS_EXE},0"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\Application" "AppUserModelId" "com.zenzeiten.lintas"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\DefaultIcon" "" "${LINTAS_EXE},0"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\shell\open\command" "" '"${LINTAS_EXE}" -- "%1"'
!macroend

!macro customInstall
  !insertmacro lintasProgId "LintasURL" "Lintas URL"
  WriteRegStr SHCTX "Software\Classes\LintasURL" "URL Protocol" ""
  !insertmacro lintasProgId "LintasHTML" "Lintas HTML Document"

  WriteRegStr SHCTX "${LINTAS_CLIENT}" "" "Lintas"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\DefaultIcon" "" "${LINTAS_EXE},0"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\shell\open\command" "" '"${LINTAS_EXE}"'
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities" "ApplicationName" "Lintas"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities" "ApplicationIcon" "${LINTAS_EXE},0"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities" "ApplicationDescription" "Fast, secure browser with a built-in Translation Management System."
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities\StartMenu" "StartMenuInternet" "Lintas"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities\URLAssociations" "http" "LintasURL"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities\URLAssociations" "https" "LintasURL"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities\FileAssociations" ".htm" "LintasHTML"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities\FileAssociations" ".html" "LintasHTML"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities\FileAssociations" ".xhtml" "LintasHTML"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities\FileAssociations" ".shtml" "LintasHTML"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities\FileAssociations" ".mht" "LintasHTML"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities\FileAssociations" ".mhtml" "LintasHTML"
  WriteRegStr SHCTX "${LINTAS_CLIENT}\Capabilities\FileAssociations" ".svg" "LintasHTML"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Lintas" "${LINTAS_CLIENT}\Capabilities"

  ; "Open with" list for web files
  WriteRegStr SHCTX "Software\Classes\.html\OpenWithProgids" "LintasHTML" ""
  WriteRegStr SHCTX "Software\Classes\.htm\OpenWithProgids" "LintasHTML" ""
  WriteRegStr SHCTX "Software\Classes\.mhtml\OpenWithProgids" "LintasHTML" ""
  WriteRegStr SHCTX "Software\Classes\.mht\OpenWithProgids" "LintasHTML" ""

  ; Tell Explorer that associations changed (SHCNE_ASSOCCHANGED)
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; Leave the registration in place during an update; remove it on a real uninstall.
  ${ifNot} ${isUpdated}
    DeleteRegValue SHCTX "Software\RegisteredApplications" "Lintas"
    DeleteRegKey SHCTX "${LINTAS_CLIENT}"
    DeleteRegKey SHCTX "Software\Classes\LintasURL"
    DeleteRegKey SHCTX "Software\Classes\LintasHTML"
    DeleteRegValue SHCTX "Software\Classes\.html\OpenWithProgids" "LintasHTML"
    DeleteRegValue SHCTX "Software\Classes\.htm\OpenWithProgids" "LintasHTML"
    DeleteRegValue SHCTX "Software\Classes\.mhtml\OpenWithProgids" "LintasHTML"
    DeleteRegValue SHCTX "Software\Classes\.mht\OpenWithProgids" "LintasHTML"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${endIf}
!macroend
