#!/usr/bin/env python3
"""Script to replace inline tab content with section components in AccountManagement.tsx"""

file_path = r'c:\Users\Alexandru Gabriel\Desktop\GitHub\filspresso_next\src\components\account\AccountManagement.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f'Original line count: {len(lines)}')

# Lines 1-1015 stay the same (0-1014 in 0-indexed)
# Lines 1016-3608 get replaced (1015-3607 in 0-indexed)  
# Lines 3609+ stay the same (3608+ in 0-indexed)

before = lines[:1015]  # Lines 1-1015
after = lines[3608:]   # Lines 3609+

replacement = '''			<div className="account-content">
				{activeTab === "profile" && account && (
					<ProfileSection
						account={account}
						isEditing={isEditing}
						editFullName={editFullName}
						editEmail={editEmail}
						newPassword={newPassword}
						confirmPassword={confirmPassword}
						totalSpending={totalSpending}
						setIsEditing={setIsEditing}
						setEditFullName={setEditFullName}
						setEditEmail={setEditEmail}
						setNewPassword={setNewPassword}
						setConfirmPassword={setConfirmPassword}
						setEditIconDataUrl={setEditIconDataUrl}
						handleSaveProfile={handleSaveProfile}
						handleChangePassword={handleChangePassword}
					/>
				)}

				{activeTab === "status" && (
					<MemberStatusSection
						capsuleStats={capsuleStats}
						consumptionHistory={consumptionHistory}
						isLoadingCapsuleStats={isLoadingCapsuleStats}
						hoveredGraphPoint={hoveredGraphPoint}
						setHoveredGraphPoint={setHoveredGraphPoint}
					/>
				)}

				{activeTab === "subscriptions" && (
					<SubscriptionSection
						subscription={subscription}
						subscriptionData={subscriptionData}
					/>
				)}

				{activeTab === "machines" && (
					<MachinesSection
						userMachines={userMachines}
						isLoadingMachines={isLoadingMachines}
						setMaintenancePopup={setMaintenancePopup}
						setRepairPopup={setRepairPopup}
						setSelectedRepairType={setSelectedRepairType}
						getProductImage={getProductImage}
					/>
				)}

				{activeTab === "payments" && (
					<PaymentsSection
						savedCards={savedCards}
						orders={orders}
						expandedOrders={expandedOrders}
						loadingOrderItems={loadingOrderItems}
						toggleOrderExpand={toggleOrderExpand}
						handleDeleteCard={handleDeleteCard}
						getProductImage={getProductImage}
					/>
				)}

				{activeTab === "history" && (
					<ChatHistorySection
						chatHistory={chatHistory}
						isLoadingHistory={isLoadingHistory}
					/>
				)}
			</div>

'''

new_content = ''.join(before) + replacement + ''.join(after)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print('File updated successfully!')
print(f'New line count: {len(new_content.splitlines())}')
