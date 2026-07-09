#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

static napi_value make_null(napi_env env) {
  napi_value value;
  napi_get_null(env, &value);
  return value;
}

static char *copy_utf8_arg(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) {
    return NULL;
  }

  char *buffer = (char *)malloc(length + 1);
  if (buffer == NULL) {
    return NULL;
  }

  if (napi_get_value_string_utf8(env, value, buffer, length + 1, &length) !=
      napi_ok) {
    free(buffer);
    return NULL;
  }

  return buffer;
}

static CFStringRef create_cf_string(const char *value) {
  return CFStringCreateWithCString(kCFAllocatorDefault, value,
                                  kCFStringEncodingUTF8);
}

static napi_value read_generic_password(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc < 2) {
    return make_null(env);
  }

  char *service = copy_utf8_arg(env, args[0]);
  char *account = copy_utf8_arg(env, args[1]);
  char *keychain_path = NULL;

  if (service == NULL || account == NULL) {
    free(service);
    free(account);
    return make_null(env);
  }

  if (argc >= 3) {
    napi_valuetype keychain_path_type;
    if (napi_typeof(env, args[2], &keychain_path_type) == napi_ok &&
        keychain_path_type == napi_string) {
      keychain_path = copy_utf8_arg(env, args[2]);
      if (keychain_path == NULL) {
        free(service);
        free(account);
        return make_null(env);
      }
    }
  }

  CFStringRef service_ref = create_cf_string(service);
  CFStringRef account_ref = create_cf_string(account);
  CFMutableDictionaryRef query =
      CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
                                &kCFTypeDictionaryKeyCallBacks,
                                &kCFTypeDictionaryValueCallBacks);

  free(service);
  free(account);

  if (service_ref == NULL || account_ref == NULL || query == NULL) {
    if (service_ref != NULL) {
      CFRelease(service_ref);
    }
    if (account_ref != NULL) {
      CFRelease(account_ref);
    }
    if (query != NULL) {
      CFRelease(query);
    }
    free(keychain_path);
    return make_null(env);
  }

  SecKeychainRef keychain_ref = NULL;
  CFArrayRef search_list = NULL;
  if (keychain_path != NULL) {
    OSStatus open_status = SecKeychainOpen(keychain_path, &keychain_ref);
    free(keychain_path);
    if (open_status != errSecSuccess || keychain_ref == NULL) {
      CFRelease(service_ref);
      CFRelease(account_ref);
      CFRelease(query);
      return make_null(env);
    }

    const void *values[] = {keychain_ref};
    search_list = CFArrayCreate(kCFAllocatorDefault, values, 1,
                                &kCFTypeArrayCallBacks);
    if (search_list == NULL) {
      CFRelease(keychain_ref);
      CFRelease(service_ref);
      CFRelease(account_ref);
      CFRelease(query);
      return make_null(env);
    }
    CFDictionarySetValue(query, kSecMatchSearchList, search_list);
  }

  CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(query, kSecAttrService, service_ref);
  CFDictionarySetValue(query, kSecAttrAccount, account_ref);
  CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
  CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);
  CFDictionarySetValue(query, kSecUseAuthenticationUI,
                       kSecUseAuthenticationUIFail);

  Boolean previous_interaction_allowed = true;
  Boolean restore_interaction_allowed =
      SecKeychainGetUserInteractionAllowed(&previous_interaction_allowed) ==
      errSecSuccess;
  SecKeychainSetUserInteractionAllowed(false);

  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching(query, &result);

  if (restore_interaction_allowed) {
    SecKeychainSetUserInteractionAllowed(previous_interaction_allowed);
  }

  CFRelease(service_ref);
  CFRelease(account_ref);
  CFRelease(query);
  if (search_list != NULL) {
    CFRelease(search_list);
  }
  if (keychain_ref != NULL) {
    CFRelease(keychain_ref);
  }

  if (status != errSecSuccess || result == NULL ||
      CFGetTypeID(result) != CFDataGetTypeID()) {
    if (result != NULL) {
      CFRelease(result);
    }
    return make_null(env);
  }

  CFDataRef password_data = (CFDataRef)result;
  napi_value password;
  napi_status napi_status =
      napi_create_string_utf8(env, (const char *)CFDataGetBytePtr(password_data),
                              (size_t)CFDataGetLength(password_data),
                              &password);
  CFRelease(result);

  if (napi_status != napi_ok) {
    return make_null(env);
  }
  return password;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "readGenericPassword", NAPI_AUTO_LENGTH,
                           read_generic_password, NULL, &fn) != napi_ok) {
    return exports;
  }
  napi_set_named_property(env, exports, "readGenericPassword", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
