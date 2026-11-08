; User-only build must never download or launch the machine-wide VC++ installer.
!define CHATBOX_USER_INSTALL
!include "${PROJECT_DIR}/assets/installer.nsh"