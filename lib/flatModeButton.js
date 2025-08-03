class flatModeButton {

	static createButton(stereoImg) {

		const container = document.createElement('div');
		container.id = 'flatModeButton';

		const controlslist = stereoImg.getAttribute('controlslist') || 'vr wiggle left right anaglyph';
		const availableModes = ['left', 'right', 'wiggle', 'anaglyph'].filter(mode => controlslist.includes(mode));

		const icons = {
			left: `
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
					<text x="12" y="17" font-size="12" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">L</text>
				</svg>`,
			right: `
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
					<text x="12" y="17" font-size="12" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">R</text>
				</svg>`,
			wiggle: `
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 12H3"/>
					<path d="m6 9-3 3 3 3"/>
					<path d="m18 15 3-3-3-3"/>
				</svg>`,
			anaglyph: `
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="9" cy="12" r="7"></circle>
    				<circle cx="15" cy="12" r="7"></circle>
				</svg>`
		};

		function stylizeContainer(element) {
			element.style.position = 'absolute';
			element.style.bottom = '20px';
			element.style.right = '20px';
			element.style.zIndex = '999';
			element.style.display = 'flex';
			element.style.border = '1px solid #fff';
			element.style.borderRadius = '4px';
			element.style.background = 'rgba(0,0,0,0.1)';
			element.style.color = '#fff';
			element.style.opacity = '0.5';
		}

		function stylizeButton(button) {
			button.style.padding = '6px';
			button.style.cursor = 'pointer';
			button.style.background = 'transparent';
			button.style.border = 'none';
			button.style.color = '#fff';
			button.style.width = '40px';
			button.style.height = '40px';
		}

		stylizeContainer(container);

		const buttons = {};
		for (const mode of availableModes) {
			const button = document.createElement('button');
			button.innerHTML = icons[mode];
			stylizeButton(button);

			button.onclick = () => stereoImg.flat = mode;

			container.appendChild(button);
			buttons[mode] = button;
		}

		function updateHighlight() {
			const currentMode = stereoImg.getAttribute('flat') || 'left';
			for (const mode in buttons) {
				buttons[mode].style.background = mode === currentMode ? 'rgba(255, 255, 255, 0.2)' : 'transparent';
			}
		}

		// Set initial highlight
		updateHighlight();

		// Listen for attribute changes to update the highlight
		const observer = new MutationObserver(updateHighlight);
		observer.observe(stereoImg, { attributes: true, attributeFilter: ['flat'] });

		return container;
	}
}

export { flatModeButton };
