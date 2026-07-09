{
  "targets": [
    {
      "target_name": "keychain_reader",
      "sources": ["src/keychain_reader.c"],
      "libraries": ["-framework Security", "-framework CoreFoundation"],
      "conditions": [
        [
          "OS!='mac'",
          {
            "sources!": ["src/keychain_reader.c"]
          }
        ]
      ]
    }
  ]
}
