#include "Maintenance.h"
#include <windows.h>
#include <shellapi.h>

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    int count = 0;
    const auto arguments = CommandLineToArgvW(GetCommandLineW(), &count);
    const bool cleanup = count == 2 && wcscmp(arguments[1], L"--cleanup-user-data") == 0;
    LocalFree(arguments);
    return cleanup ? (FilspressoMaintenance::CleanupCurrentUser() ? 0 : 1)
        : FilspressoMaintenance::LaunchUninstall();
}
