class soundButton {

	/**
	 * A button to turn the sound of the picture on and off.
	 * @param {HTMLElement} stereoImg - the element, which says if the sound is on (soundOn) and switches it (toggleSound)
	 */
	static createButton(stereoImg) {

		const button = document.createElement('button');
		button.id = 'soundButton';

		const icons = {
			on: `
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M11 5 6 9H2v6h4l5 4z"/>
					<path d="M15.5 8.5a5 5 0 0 1 0 7"/>
					<path d="M18.5 5.5a9 9 0 0 1 0 13"/>
				</svg>`,
			off: `
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M11 5 6 9H2v6h4l5 4z"/>
					<path d="m22 9-6 6"/>
					<path d="m16 9 6 6"/>
				</svg>`
		};

		button.style.position = 'absolute';
		button.style.bottom = '20px';
		button.style.left = '20px';
		button.style.zIndex = '999';
		button.style.width = '40px';
		button.style.height = '40px';
		button.style.padding = '6px';
		button.style.cursor = 'pointer';
		button.style.border = '1px solid #fff';
		button.style.borderRadius = '4px';
		button.style.background = 'rgba(0,0,0,0.1)';
		button.style.color = '#fff';
		button.style.opacity = '0.5';

		button.onmouseenter = () => button.style.opacity = '1.0';
		button.onmouseleave = () => button.style.opacity = '0.5';
		button.onclick = () => stereoImg.toggleSound();

		// Show the state of the sound
		button.update = () => {
			const on = stereoImg.soundOn;
			button.innerHTML = icons[on ? 'on' : 'off'];
			button.setAttribute('aria-label', 'Sound');
			button.setAttribute('aria-pressed', on ? 'true' : 'false');
		};
		button.update();

		return button;
	}
}

export { soundButton };
