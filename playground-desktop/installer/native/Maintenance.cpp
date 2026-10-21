#include "Maintenance.h"
#include <windows.h>
#include <wincred.h>
#include <shlobj.h>
#include <shellapi.h>
#include <msi.h>
#include <filesystem>
#include <vector>

namespace FilspressoMaintenance {
    static bool Missing(DWORD error) {
        return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND;
    }

    // Do not follow junctions or symbolic links out of an application-owned directory.
    bool DeleteOwnedTree(const std::wstring& path) {
        const auto attributes = GetFileAttributesW(path.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES) return Missing(GetLastError());
        if (attributes & FILE_ATTRIBUTE_REPARSE_POINT) {
            return (attributes & FILE_ATTRIBUTE_DIRECTORY)
                ? RemoveDirectoryW(path.c_str()) != FALSE
                : DeleteFileW(path.c_str()) != FALSE;
        }
        if (!(attributes & FILE_ATTRIBUTE_DIRECTORY)) {
            if (attributes & FILE_ATTRIBUTE_READONLY) SetFileAttributesW(path.c_str(), attributes & ~FILE_ATTRIBUTE_READONLY);
            return DeleteFileW(path.c_str()) != FALSE;
        }

        WIN32_FIND_DATAW entry{};
        const auto find = FindFirstFileW((path + L"\\*").c_str(), &entry);
        bool success = true;
        if (find != INVALID_HANDLE_VALUE) {
            do {
                if (wcscmp(entry.cFileName, L".") != 0 && wcscmp(entry.cFileName, L"..") != 0) {
                    if (!DeleteOwnedTree(path + L"\\" + entry.cFileName)) success = false;
                }
            } while (FindNextFileW(find, &entry));
            if (GetLastError() != ERROR_NO_MORE_FILES) success = false;
            FindClose(find);
        } else if (GetLastError() != ERROR_FILE_NOT_FOUND) {
            success = false;
        }
        if (attributes & FILE_ATTRIBUTE_READONLY) SetFileAttributesW(path.c_str(), attributes & ~FILE_ATTRIBUTE_READONLY);
        return RemoveDirectoryW(path.c_str()) != FALSE && success;
    }

    bool ClearCredentials(const std::wstring& prefix) {
        bool success = true;
        for (const auto name : { L"/session", L"/device-id" }) {
            if (!CredDeleteW((prefix + name).c_str(), CRED_TYPE_GENERIC, 0) && GetLastError() != ERROR_NOT_FOUND)
                success = false;
        }
        return success;
    }

    bool CleanupCurrentUser() {
        bool success = ClearCredentials(CredentialPrefix);
        for (const auto folder : { FOLDERID_LocalAppData, FOLDERID_RoamingAppData }) {
            PWSTR location = nullptr;
            if (FAILED(SHGetKnownFolderPath(folder, KF_FLAG_DONT_VERIFY, nullptr, &location))) { success = false; continue; }
            const std::wstring vendor = std::wstring(location) + L"\\Filspresso";
            if (!DeleteOwnedTree(vendor + L"\\Playground")) success = false;
            // Remove the vendor directory only if it is now empty; other products may use it.
            RemoveDirectoryW(vendor.c_str());
            CoTaskMemFree(location);
        }
        const auto registry = RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\Filspresso\\Playground");
        if (registry != ERROR_SUCCESS && registry != ERROR_FILE_NOT_FOUND) success = false;
        return success;
    }

    int LaunchUninstall() {
        std::vector<wchar_t> module(32768);
        GetModuleFileNameW(nullptr, module.data(), static_cast<DWORD>(module.size()));
        const auto ownFolder = std::filesystem::path(module.data()).parent_path().lexically_normal().wstring();
        std::wstring selected;
        wchar_t product[39]{};
        for (DWORD index = 0; MsiEnumRelatedProductsW(UpgradeCode, 0, index, product) == ERROR_SUCCESS; ++index) {
            wchar_t installed[32768]{};
            DWORD length = static_cast<DWORD>(std::size(installed));
            if (MsiGetProductInfoW(product, INSTALLPROPERTY_INSTALLLOCATION, installed, &length) == ERROR_SUCCESS) {
                auto location = std::filesystem::path(installed).lexically_normal().wstring();
                while (!location.empty() && (location.back() == L'\\' || location.back() == L'/')) location.pop_back();
                if (_wcsicmp(ownFolder.c_str(), location.c_str()) == 0) { selected = product; break; }
            }
        }
        if (selected.empty()) {
            MessageBoxW(nullptr, L"This folder is not registered as an installed copy of Filspresso Playground. Use Windows Settings > Apps to remove an installed copy.", L"Filspresso Playground", MB_OK | MB_ICONINFORMATION);
            return 1;
        }
        wchar_t system[32768]{};
        GetSystemDirectoryW(system, static_cast<UINT>(std::size(system)));
        const auto executable = std::wstring(system) + L"\\msiexec.exe";
        const auto arguments = L"/x " + selected;
        // Windows Installer owns file removal and elevation. Exit immediately so the
        // installed Uninstall.exe is no longer running when RemoveFiles reaches it.
        const auto result = ShellExecuteW(nullptr, L"open", executable.c_str(), arguments.c_str(), nullptr, SW_SHOWNORMAL);
        if (reinterpret_cast<INT_PTR>(result) <= 32) {
            MessageBoxW(nullptr, L"Windows Installer could not be started. Try uninstalling from Windows Settings > Apps.", L"Filspresso Playground", MB_OK | MB_ICONERROR);
            return 1;
        }
        return 0;
    }
}
