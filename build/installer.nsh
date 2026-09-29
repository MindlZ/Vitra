; Vitra's look for the installer and uninstaller. electron-builder picks this
; up from build/ (buildResources) and includes it ahead of its own template,
; so the defines below are in place before any page is created.
;
; NSIS's Modern UI lets exactly three surfaces be restyled: the welcome and
; finish pages, and the header band across the top of the pages between
; them. Those get Vitra's plum and the sunrise art (installerSidebar.bmp,
; installerHeader.bmp, drawn from build/installer-art). The body of the inner
; pages and the button strip stay Windows' own; theming native buttons and
; radio buttons means owner-drawing them, which isn't worth the fragility.

; The splash's top colour. The art's edges are this exact colour, so the
; sidebar and header image meet their pages without a seam.
!define MUI_BGCOLOR "120B17"
!define MUI_TEXTCOLOR "F5EFF6"

; The header control's size follows the dialog font, so it's rarely exactly
; the bitmap's 150 x 57; the default stretch squashed the V and the sun.
!define MUI_HEADERIMAGE_BITMAP_STRETCH "AspectFitHeight"

; Titles in a condensed display face, standing in for the app's Bricolage
; Grotesque (installers can only use installed fonts). Bahnschrift ships with
; Windows 10 and 11; GDI falls back to the default face where it's missing.
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

; Replaces the template's finish page to add the styling hook; the launch
; behaviour is the template's own (assistedInstaller.nsh), unchanged.
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
    ; With visual styles, a checkbox ignores SetCtlColors and draws black
    ; text, unreadable on plum. Unthemed, it takes MUI_TEXTCOLOR. (Modern UI
    ; only does this itself in High Contrast mode.)
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

; The template inserts this just before the uninstaller's finish page and has
; no hook for that page itself, so its title goes here: a page's MUI_*
; defines apply to the next page inserted. Only the text, though. A show
; function can't restyle the title: the page declares $mui.FinishPage.Title
; when it's inserted, after this, so the font stays Modern UI's bold.
!macro customUninstallPage
  !define MUI_FINISHPAGE_TITLE "Vitra is uninstalled"
!macroend
