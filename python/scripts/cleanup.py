import subprocess
import sys

# Get installed packages via pip
installed_packages = subprocess.check_output([sys.executable, "-m", "pip", "freeze"]).decode().splitlines()

# Read the required libraries from requirements.txt
with open("requirements.txt", "r") as f:
    required_libraries = f.read().splitlines()

# Convert installed packages to a set of package names (without version)
installed_package_names = {pkg.split('==')[0] for pkg in installed_packages}

# Convert required libraries to a set of package names (without version)
required_package_names = {pkg.split('==')[0] for pkg in required_libraries}

# Find packages that are installed but not in requirements.txt
unused_packages = installed_package_names - required_package_names

# Uninstall unused packages
for package in unused_packages:
    print(f"Uninstalling unused package: {package}")
    subprocess.check_call([sys.executable, "-m", "pip", "uninstall", "-y", package])

print("Unused packages have been removed.")
