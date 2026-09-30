; only welcome/finish pages and the header band can be restyled; inner page
; bodies and the button strip stay native

; the art's edges are exactly this, so they meet the pages seamlessly
!define MUI_BGCOLOR "120B17"
!define MUI_TEXTCOLOR "F5EFF6"

; the header control sizes to the dialog font; the default stretch squashed the art
!define MUI_HEADERIMAGE_BITMAP_STRETCH "AspectFitHeight"

; installed fonts only, so no Bricolage
!macro vitraTitleFont CONTROL
  Push $0
  CreateFont $0 "Bahnschrift SemiBold SemiConden" 20 400
  SendMessage ${CONTROL} ${WM_SETFONT} $0 1
  Pop $0
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Vitra"
  !define MUI_WELCOMEPAGE_TEXT "All your games in one place.$\r$\n$\r$\nClick Next to continue."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW vitraWelcomeShow
  !insertmacro MUI_PAGE_WELCOME

  Function vitraWelcomeShow
    !insertmacro vitraTitleFont $mui.WelcomePage.Title
  FunctionEnd
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

  !define MUI_FINISHPAGE_TITLE "Vitra is ready"
  !define MUI_FINISHPAGE_TEXT " "
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_RUN_TEXT "Open Vitra"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW vitraFinishShow
  !insertmacro MUI_PAGE_FINISH

  Function vitraFinishShow
    !insertmacro vitraTitleFont $mui.FinishPage.Title
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
  FunctionEnd
!macroend

; no hook for the uninstaller's finish page: MUI_* defines apply to the next page
; inserted, so the title goes here. can't take the font: $mui.FinishPage.Title is
; declared after this
!macro customUninstallPage
  !define MUI_FINISHPAGE_TITLE "Vitra is uninstalled"
!macroend
