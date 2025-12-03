file_path = r"c:\Users\Alexandru Gabriel\Desktop\GitHub\filspresso_next\src\components\account\AccountManagement.tsx"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the maintenance popup section and replace it
old_section_start = """{/* Maintenance Popup Modal - Rendered via Portal */}
			{mounted &&
				maintenancePopup.open &&
				maintenancePopup.machine &&
				createPortal("""

# Find where the maintenance popup ends (before the Repair Request Modal comment)
end_marker = """{/* Repair Request Modal */}"""

start_idx = content.find(old_section_start)
if start_idx == -1:
    print("Could not find maintenance popup start")
    exit(1)

end_idx = content.find(end_marker, start_idx)
if end_idx == -1:
    print("Could not find maintenance popup end")
    exit(1)

# Replace the section
new_section = """{/* Maintenance Popup Modal */}
			{mounted && (
				<MaintenancePopup
					isOpen={maintenancePopup.open}
					machine={maintenancePopup.machine}
					onClose={() => setMaintenancePopup({ open: false, machine: null })}
				/>
			)}

			"""

new_content = content[:start_idx] + new_section + content[end_idx:]

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f"Done! Replaced maintenance popup section")
