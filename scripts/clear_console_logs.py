import re
import os

def remove_console_logs_from_file(file_path):
    # Read the contents of the file
    with open(file_path, 'r') as file:
        content = file.read()

    # Regular expression to match console.log statements
    pattern = r'console\.log\(.*?\);?'

    # Remove all console.log statements
    modified_content = re.sub(pattern, '', content)

    # Write the modified content back to the file
    with open(file_path, 'w') as file:
        file.write(modified_content)

    print(f"Removed all console.log statements from {file_path}")

def remove_console_logs_from_directory(directory):
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith('.ts') or file.endswith(".tsx"):
                file_path = os.path.join(root, file)
                remove_console_logs_from_file(file_path)

if __name__ == "__main__":
    src_directory = 'src'  # Change this to the path of your src directory
    remove_console_logs_from_directory(src_directory)