; Shroudly NSIS hooks (electron-builder `nsis.include`).
;
; Installing over a running Shroudly, or uninstalling it, closes the app
; without letting it restore the Windows proxy. If the proxy still points at
; a local Shroudly endpoint, switch it off so the user keeps their internet.
; Also remove Shroudly's login entries, so nothing keeps calling a removed exe.

!include LogicLib.nsh
!include WinVer.nsh

!define SHROUDLY_INET "Software\Microsoft\Windows\CurrentVersion\Internet Settings"

!macro shroudlyResetProxy
  ReadRegStr $0 HKCU "${SHROUDLY_INET}" "ProxyServer"
  StrCpy $1 $0 16
  ReadRegStr $2 HKCU "${SHROUDLY_INET}" "AutoConfigURL"
  StrCpy $3 $2 17
  ${If} $1 == "socks=127.0.0.1:"
  ${OrIf} $3 == "http://127.0.0.1:"
    WriteRegDWORD HKCU "${SHROUDLY_INET}" "ProxyEnable" 0
    ${If} $1 == "socks=127.0.0.1:"
      DeleteRegValue HKCU "${SHROUDLY_INET}" "ProxyServer"
    ${EndIf}
    ${If} $3 == "http://127.0.0.1:"
      DeleteRegValue HKCU "${SHROUDLY_INET}" "AutoConfigURL"
    ${EndIf}
    ReadRegStr $4 HKCU "${SHROUDLY_INET}" "ProxyOverride"
    ${If} $4 == "<local>;127.*;10.*;172.16.*;192.168.*;localhost"
      DeleteRegValue HKCU "${SHROUDLY_INET}" "ProxyOverride"
    ${EndIf}
  ${EndIf}
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" "ShroudlyProxyRestore"
!macroend

!macro customInit
  ; Electron 43 does not run on Windows 8.1 or earlier. Without this the
  ; installer would succeed and the app would then fail to start with nothing
  ; to explain why, so say it here instead and stop.
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP \
      "Shroudly needs Windows 10 or later.$\r$\n$\r$\n\
Shroudly, Windows 10 veya daha yenisini gerektirir."
    Abort
  ${EndIf}
  !insertmacro shroudlyResetProxy
!macroend

!macro customUnInstall
  !insertmacro shroudlyResetProxy
  ; An update also runs the old uninstaller: keep the user's auto-start then.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Shroudly"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Shroudly"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "me.codeshare.shroudly"
  ${endIf}
!macroend
