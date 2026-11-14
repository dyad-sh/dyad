#include "DyadInstallGuard.h"
#include <cstdio>

// A disposable executable for Windows integration tests. Never ships with Dyad.
int wmain(int argc, wchar_t** argv) {
    if (argc >= 2 && wcscmp(argv[1], L"--wait") == 0) {
        puts("READY");
        fflush(stdout);
        Sleep(INFINITE);
        return 0;
    }
    if (argc >= 3 && wcscmp(argv[1], L"--acquire") == 0) {
        dyad::InstallGuard guard;
        std::wstring error;
        DWORD result = guard.Acquire(argv[2], error);
        if (result != ERROR_SUCCESS) return static_cast<int>(result);
        puts("READY");
        fflush(stdout);
        if (argc >= 4 && wcscmp(argv[3], L"--hold") == 0) Sleep(INFINITE);
        return 0;
    }
    if (argc == 4 && wcscmp(argv[1], L"--inside") == 0) {
        return dyad::IsInsideInstallation(argv[2], argv[3]) ? 0 : 1;
    }
    // Squirrel's install/update hooks and normal launch finish immediately.
    return 0;
}
