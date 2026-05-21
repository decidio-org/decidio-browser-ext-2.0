# decidio-browser-extension
This is the repository for the Chrome and Safari browser extension. Created and maintained by Jenna Mena and Tahlia Kamieniecki


## Summary
Upon activation, the extension scrapes the website and will give Gemini the data. The Ai is given a hard-coded prompt and a schema to format the product data. The extension outputs the result using the desired "typing" effect.


## Features

* **Add button** - Adds the product into the user's Decidio List
* **"-" button** - Change the extension view to a smaller version
* **Jump-up button** - Sharp jump to the top of the product specification table
* **Hamburger Menu** - 
* **< button** - Closes the extension

* **Spinner** - Appears while the Ai is "thinking"

## Testing

### Chrome Extension

1. Download the **shared** folder and the **manifest.json** file for Chrome. 
    - Put **manifest.json** inside the **shared** folder.

2. Open the Chrome browser and head to **Extensions** -> **"Manage Extensions"**

3. Turn on Developer mode

4. Hit the button labeled **Load unpacked** and select the downloaded folder.

The extension is ready for testing. Pin the extension to the task bar for easy use.
    - Any changes done to the files in the folder the extension is linked to will require you to hit the **refresh** button.
    - After the extension has been refreshed, reload the site you are testing the extension on. The extension would now be up to date.


#### Handling Errors

In the **Manage Extensions** page, click on the **Errors** button. This would lead you to a new page where you can view the errors that are occuring.