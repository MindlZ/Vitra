; MUI themes welcome/finish and the header; everything else is recoloured by
; vitraPaint (below), page by page

; the art's edges are exactly this, so they meet the pages seamlessly
!define MUI_BGCOLOR "120B17"
!define MUI_TEXTCOLOR "F5EFF6"
!define VITRA_BG "120B17"
!define VITRA_TEXT "F5EFF6"
!define VITRA_FIELD "1E1526"
!define VITRA_MUTED "8A7F91"
; COLORREFs are 0xBBGGRR: field, text, and the Sunset coral (ff8482)
!define VITRA_FIELD_REF 0x26151E
!define VITRA_TEXT_REF 0xF6EFF5
!define VITRA_ACCENT_REF 0x8284FF

; this file is included before MUI2, so the functions live in customHeader
!ifndef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_GUIINIT vitraGuiInit
!else
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.vitraGuiInit
!endif

; the header control sizes to the dialog font; the default stretch squashed the art
!define MUI_HEADERIMAGE_BITMAP_STRETCH "AspectFitHeight"

; installed fonts only, so no Bricolage
!macro vitraTitleFont CONTROL
  Push $0
  CreateFont $0 "Bahnschrift SemiBold SemiConden" 20 400
  SendMessage ${CONTROL} ${WM_SETFONT} $0 1
  Pop $0
!macroend

; an existing install: electron-builder already reuses its folder and per-user /
; per-machine mode (initMultiUser) and replaces it, but only says so for a silent
; auto-update (--updated). these name it an update and skip the two choice pages.
; vars only in the installer pass: an unused var fails the -WX build
!ifndef BUILD_UNINSTALLER
  !include WordFunc.nsh

  Var vitraOld
  Var vitraTitle
  Var vitraText
  Var vitraButton
  Var vitraFinish

  ; runs in .onInit after initMultiUser, so SHELL_CONTEXT and $INSTDIR are the old install's
  !macro customInit
    StrCpy $vitraTitle "Welcome to Vitra"
    StrCpy $vitraText "All your games in one place.$\r$\n$\r$\nClick Next to continue."
    StrCpy $vitraButton ""
    StrCpy $vitraFinish "Vitra is ready"
    ReadRegStr $vitraOld SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    ; a leftover registry entry without the app isn't an install
    ${IfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      StrCpy $vitraOld ""
    ${EndIf}
    ${If} $vitraOld != ""
      ; 0 same, 1 installed is newer, 2 this is newer
      ${VersionCompare} $vitraOld "${VERSION}" $R0
      ${If} $R0 == 2
        StrCpy $vitraTitle "Update Vitra"
        StrCpy $vitraText "$vitraOld to ${VERSION}$\r$\n$\r$\nYour library and playtime are kept."
        StrCpy $vitraButton "Update"
        StrCpy $vitraFinish "Vitra is updated"
      ${ElseIf} $R0 == 0
        StrCpy $vitraTitle "Reinstall Vitra"
        StrCpy $vitraText "Vitra ${VERSION} is already installed.$\r$\n$\r$\nYour library and playtime are kept."
        StrCpy $vitraButton "Reinstall"
      ${Else}
        StrCpy $vitraTitle "Install Vitra ${VERSION}"
        StrCpy $vitraText "Vitra $vitraOld is installed, which is newer.$\r$\n$\r$\nYour library and playtime are kept."
        StrCpy $vitraButton "Install"
      ${EndIf}
    ${EndIf}
  !macroend

  ; mode page: keep the old install's mode instead of asking. per-machine still
  ; elevates here, as it would after a choice
  !macro customInstallMode
    ${If} $vitraOld != ""
      ${If} $hasPerUserInstallation == "1"
      ${AndIf} $hasPerMachineInstallation == "0"
        StrCpy $isForceCurrentInstall "1"
      ${ElseIf} $hasPerMachineInstallation == "1"
      ${AndIf} $hasPerUserInstallation == "0"
        StrCpy $isForceMachineInstall "1"
      ${EndIf}
    ${EndIf}
  !macroend
!endif

; welcome, install mode, directory, then instfiles (assistedInstaller.nsh). from
; welcome, this many pages on is instfiles; recount if a page is ever added
!define VITRA_PAGES_TO_INSTALL 3

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$vitraTitle"
  !define MUI_WELCOMEPAGE_TEXT "$vitraText"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW vitraWelcomeShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE vitraWelcomeLeave
  !insertmacro MUI_PAGE_WELCOME

  Function vitraWelcomeShow
    !insertmacro vitraTitleFont $mui.WelcomePage.Title
    Call vitraGuiInit
    ${If} $vitraButton != ""
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${WM_SETTEXT} 0 "STR:$vitraButton"
    ${EndIf}
  FunctionEnd

  ; straight to installing: the folder and mode are the old install's. a
  ; per-machine install that isn't elevated yet goes through the mode page,
  ; which elevates and restarts the installer, and the elevated one jumps
  Function vitraWelcomeLeave
    ${If} $vitraOld == ""
      Return
    ${EndIf}
    ${If} $hasPerMachineInstallation == "1"
    ${AndIfNot} ${UAC_IsAdmin}
      Return
    ${EndIf}
    ${If} $hasPerUserInstallation == "1"
    ${AndIf} $hasPerMachineInstallation == "1"
      Return
    ${EndIf}
    SendMessage $HWNDPARENT 0x408 ${VITRA_PAGES_TO_INSTALL} ""
    Abort
  FunctionEnd

  ; taken by the next page inserted: the install mode page (multiUserUi.nsh
  ; calls MUI's SHOW hook)
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW vitraPageShow
!macroend

; inserted just before instfiles, so this SHOW is instfiles'. the directory page
; between has no free hook: .onVerifyInstDir (below) paints it
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW vitraPageShow
!macroend

; runs as the uninstall section starts, with its progress page up
!macro customUnInstall
  Call un.vitraPageShow
!macroend

; $0 = a window: it and every child in Vitra's colours. themed checkboxes,
; radios and group boxes ignore SetCtlColors, so they're un-themed first; push
; buttons can't be recoloured, but Windows' dark button theme fits
!macro vitraPaintFunctions UN
  Function ${UN}vitraPaint
    Push $1
    Push $2
    Push $3
    SetCtlColors $0 ${VITRA_TEXT} ${VITRA_BG}
    StrCpy $1 0
    next:
      FindWindow $1 "" "" $0 $1
      StrCmp $1 0 done
      System::Call 'user32::GetClassName(p r1, t .r2, i 64)'
      ${If} $2 == "Button"
        System::Call 'user32::GetWindowLong(p r1, i -16) i .r3'
        IntOp $3 $3 & 0xF
        ; 0/1 = push / default push
        ${If} $3 <= 1
          System::Call 'uxtheme::SetWindowTheme(p r1, w "DarkMode_Explorer", p 0)'
        ; group box: unthemed, its frame is a bright 3D line; the page header names the field
        ${ElseIf} $3 == 7
          ShowWindow $1 ${SW_HIDE}
        ${Else}
          System::Call 'uxtheme::SetWindowTheme(p r1, w " ", w " ")'
          SetCtlColors $1 ${VITRA_TEXT} ${VITRA_BG}
        ${EndIf}
      ${ElseIf} $2 == "Edit"
        System::Call 'uxtheme::SetWindowTheme(p r1, w "DarkMode_CFD", p 0)'
        SetCtlColors $1 ${VITRA_TEXT} ${VITRA_FIELD}
      ${ElseIf} $2 == "msctls_progress32"
        ; bar colours only take while unthemed
        System::Call 'uxtheme::SetWindowTheme(p r1, w " ", w " ")'
        SendMessage $1 0x409 0 ${VITRA_ACCENT_REF}
        SendMessage $1 0x2001 0 ${VITRA_FIELD_REF}
      ${ElseIf} $2 == "SysListView32"
        SendMessage $1 0x1001 0 ${VITRA_FIELD_REF}
        SendMessage $1 0x1026 0 ${VITRA_FIELD_REF}
        SendMessage $1 0x1024 0 ${VITRA_TEXT_REF}
      ${ElseIf} $2 == "Static"
        ; separators draw a bright 3D line whatever the colours; told apart by
        ; being 1-2px tall, since MUI re-shows them per page
        System::Call '*(i, i, i, i) p .r3'
        System::Call 'user32::GetWindowRect(p r1, p r3)'
        System::Call '*$3(i, i .r2, i, i .r4)'
        System::Free $3
        IntOp $4 $4 - $2
        System::Call 'user32::GetDlgCtrlID(p r1) i .r2'
        ${If} $4 <= 2
          ShowWindow $1 ${SW_HIDE}
        ; the "Vitra x.y.z" branding: disabled, so it draws etched; enabled it takes colours
        ${ElseIf} $2 == 1028
          EnableWindow $1 1
          SetCtlColors $1 /BRANDING ${VITRA_MUTED} ${VITRA_BG}
        ${Else}
          SetCtlColors $1 ${VITRA_TEXT} ${VITRA_BG}
        ${EndIf}
      ${ElseIf} $2 != "#32770"
        SetCtlColors $1 ${VITRA_TEXT} ${VITRA_BG}
      ${EndIf}
      Goto next
    done:
    Pop $3
    Pop $2
    Pop $1
  FunctionEnd

  ; the outer window: header, button strip, branding
  Function ${UN}vitraGuiInit
    Push $0
    StrCpy $0 $HWNDPARENT
    Call ${UN}vitraPaint
    Pop $0
  FunctionEnd

  ; the outer window again (MUI re-shows the separators), then the page's inner dialog
  Function ${UN}vitraPageShow
    Call ${UN}vitraGuiInit
    Push $0
    FindWindow $0 "#32770" "" $HWNDPARENT
    ${If} $0 != 0
      Call ${UN}vitraPaint
    ${EndIf}
    Pop $0
  FunctionEnd
!macroend

; after MUI2 and LogicLib, in both passes; each pass gets only the functions it
; calls (-WX)
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    !insertmacro vitraPaintFunctions ""

    ; called when the directory page appears and as the path is edited
    Function .onVerifyInstDir
      Call vitraPageShow
    FunctionEnd
  !else
    !insertmacro vitraPaintFunctions "un."
  !endif
!macroend

; StartApp copied as-is from the template (assistedInstaller.nsh)
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "$vitraFinish"
  !define MUI_FINISHPAGE_TEXT " "
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_RUN_TEXT "Open Vitra"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW vitraFinishShow
  !insertmacro MUI_PAGE_FINISH

  Function vitraFinishShow
    !insertmacro vitraTitleFont $mui.FinishPage.Title
    Call vitraGuiInit
    ; themed checkboxes ignore SetCtlColors (black on plum); unthemed takes MUI_TEXTCOLOR
    System::Call 'UXTHEME::SetWindowTheme(p$mui.FinishPage.Run,w" ",w" ")'
  FunctionEnd
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Uninstall Vitra"
  !define MUI_WELCOMEPAGE_TEXT "Your library and playtime are kept.$\r$\n$\r$\nClick Next to continue."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.vitraWelcomeShow
  !insertmacro MUI_UNPAGE_WELCOME

  Function un.vitraWelcomeShow
    !insertmacro vitraTitleFont $mui.WelcomePage.Title
    Call un.vitraGuiInit
  FunctionEnd

  ; the uninstaller's mode page, shown only when both modes are installed
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.vitraPageShow
!macroend

; no hook for the uninstaller's finish page: MUI_* defines apply to the next page
; inserted, so the title goes here. can't take the font: $mui.FinishPage.Title is
; declared after this
!macro customUninstallPage
  !define MUI_FINISHPAGE_TITLE "Vitra is uninstalled"
!macroend
