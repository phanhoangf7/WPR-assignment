document.addEventListener("DOMContentLoaded", function () {
	const deleteButton = document.getElementById("deleteButton");
	if (!deleteButton) return;

	deleteButton.addEventListener("click", async function () {
		const checkboxes = document.querySelectorAll(".email-checkbox:checked");
		const emailIds = Array.from(checkboxes).map((cb) => cb.dataset.id);

		if (emailIds.length === 0) {
			alert("Please select at least one email to delete");
			return;
		}

		if (!confirm("Are you sure you want to delete the selected emails?")) {
			return;
		}

		try {
			const response = await fetch("/api/emails", {
				method: "DELETE",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ emailIds }),
			});

			if (!response.ok) {
				throw new Error("Failed to delete emails");
			}

			// Remove deleted emails from the UI
			emailIds.forEach((id) => {
				const emailItem = document
					.querySelector(`.email-checkbox[data-id="${id}"]`)
					.closest(".email-item");
				emailItem.remove();
			});
		} catch (error) {
			console.error("Error deleting emails:", error);
			alert("Failed to delete emails. Please try again.");
		}
	});
});
