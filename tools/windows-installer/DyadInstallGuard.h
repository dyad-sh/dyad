// Dyad's preflight for Squirrel.Windows 2.0.1. Runs before installer extraction.
#pragma once

#include <windows.h>
#include <sddl.h>
#include <tlhelp32.h>
#include <cwchar>
#include <string>
#include <vector>

namespace dyad {

class Handle {
public:
    explicit Handle(HANDLE value = NULL) : value_(value) {}
    ~Handle() { if (value_ && value_ != INVALID_HANDLE_VALUE) CloseHandle(value_); }
    HANDLE get() const { return value_; }
private:
    Handle(const Handle&);
    Handle& operator=(const Handle&);
    HANDLE value_;
};

inline bool IsInsideInstallation(const std::wstring& image, const std::wstring& root) {
    std::wstring prefix = root;
    if (prefix.empty()) return false;
    if (prefix.back() != L'\\') prefix += L'\\';
    return image.size() > prefix.size() &&
        _wcsnicmp(image.c_str(), prefix.c_str(), prefix.size()) == 0;
}

inline bool MayBlockUninspectableProcess(bool knownName, bool sessionKnown, DWORD ourSession, DWORD otherSession) {
    return knownName && (!sessionKnown || ourSession == otherSession);
}

inline bool MayBlockUninspectableProcess(bool knownName, DWORD processId) {
    DWORD ourSession = 0, otherSession = 0;
    const bool sessionKnown = ProcessIdToSessionId(GetCurrentProcessId(), &ourSession) &&
        ProcessIdToSessionId(processId, &otherSession);
    return MayBlockUninspectableProcess(knownName, sessionKnown, ourSession, otherSession);
}

// Unlike Process.MainModule, this works across the 32/64-bit process boundary.
inline bool InstallationIsIdle(const std::wstring& root) {
    Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
    if (snapshot.get() == INVALID_HANDLE_VALUE) return false;
    PROCESSENTRY32W entry = {};
    entry.dwSize = sizeof(entry);
    if (!Process32FirstW(snapshot.get(), &entry)) return false;
    do {
        if (entry.th32ProcessID == 0 || entry.th32ProcessID == GetCurrentProcessId()) continue;
        const bool candidate = _wcsicmp(entry.szExeFile, L"dyad.exe") == 0 ||
            _wcsicmp(entry.szExeFile, L"Update.exe") == 0 ||
            _wcsicmp(entry.szExeFile, L"Squirrel.exe") == 0;
        Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, entry.th32ProcessID));
        if (!process.get()) {
            // Processes can exit between enumeration and inspection. Inaccessible
            // Known processes in our session must not be mistaken for an idle
            // installation. Other users' inaccessible updaters must not block us.
            if (GetLastError() != ERROR_INVALID_PARAMETER && MayBlockUninspectableProcess(candidate, entry.th32ProcessID)) return false;
            continue;
        }
        std::vector<wchar_t> image(32768);
        DWORD length = static_cast<DWORD>(image.size());
        if (!QueryFullProcessImageNameW(process.get(), 0, image.data(), &length)) {
            DWORD exitCode = STILL_ACTIVE;
            if ((!GetExitCodeProcess(process.get(), &exitCode) || exitCode == STILL_ACTIVE) &&
                MayBlockUninspectableProcess(candidate, entry.th32ProcessID)) return false;
            continue;
        }
        if (IsInsideInstallation(std::wstring(image.data(), length), root)) return false;
    } while (Process32NextW(snapshot.get(), &entry));
    return GetLastError() == ERROR_NO_MORE_FILES;
}

inline std::wstring SetupMutexName() {
    HANDLE rawToken = NULL;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &rawToken)) return L"";
    Handle token(rawToken);
    DWORD length = 0;
    GetTokenInformation(token.get(), TokenUser, NULL, 0, &length);
    if (!length) return L"";
    std::vector<BYTE> buffer(length);
    if (!GetTokenInformation(token.get(), TokenUser, buffer.data(), length, &length)) return L"";
    LPWSTR sid = NULL;
    if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(buffer.data())->User.Sid, &sid)) return L"";
    // Global spans Windows sessions; the SID keeps other users independent.
    std::wstring name = L"Global\\DyadSetup-" + std::wstring(sid);
    LocalFree(sid);
    return name;
}

class InstallGuard {
public:
    InstallGuard() : mutex_(NULL), ownsMutex_(false) {}
    ~InstallGuard() {
        if (ownsMutex_) ReleaseMutex(mutex_);
        if (mutex_) CloseHandle(mutex_);
    }

    DWORD Acquire(const std::wstring& root, std::wstring& error) {
        const std::wstring name = SetupMutexName();
        if (name.empty()) {
            error = L"Setup could not check whether another installation is running. Please try again.";
            return ERROR_INSTALL_FAILURE;
        }
        mutex_ = CreateMutexW(NULL, TRUE, name.c_str());
        const DWORD mutexError = GetLastError();
        if (!mutex_) {
            error = L"Setup could not acquire the installation lock. Please try again.";
            return ERROR_INSTALL_FAILURE;
        }
        if (mutexError == ERROR_ALREADY_EXISTS) {
            error = L"Dyad installation is already in progress. Please wait for it to finish.";
            return ERROR_INSTALL_ALREADY_RUNNING;
        }
        ownsMutex_ = true;
        if (!InstallationIsIdle(root)) {
            error = L"Please close Dyad completely before reinstalling. If you just closed it, wait a moment and try again.";
            return ERROR_BUSY;
        }
        return ERROR_SUCCESS;
    }
private:
    InstallGuard(const InstallGuard&);
    InstallGuard& operator=(const InstallGuard&);
    HANDLE mutex_;
    bool ownsMutex_;
};

} // namespace dyad
