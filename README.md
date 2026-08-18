# decidio-browser-extension
This is the repository for the Chrome and Safari browser extension. Created and maintained by Jenna Mena and Tahlia Kamieniecki


## Summary
The extension has an icon for when it is on/off. Once on, the toggle and the side panel appear and the user would be able to select products to add to their list. Details will be listed below, along with features that may need to be worked on/fixed


## Features

* **decidio. toggle button** - The square button on the upper right hand side of the screen. This button allows the user to toggle the side panel in or out. In Decidio Interaction Mode (Picker/DIM), you can click the toggle to cancel the action.
*     Once products are being selected, the total number of products will be shown inside a red circle, much like how notifications look on mobile devices.
* **decidio side panel** - This is the body of the extension where the rest of the features reside in
* **LISTS section** - Contains a button with a sliding animation to show the option to create a list (not functional)
* **COLLECT section** - Contains an "add" button which triggers DIM. There is also the "SINGLE" and "MULTI" buttons which allows the user to select one or multiple products.
* **Decidio Interaction Mode (DIM)** - Upon activation, a semi-transparent overlay goes on top of the screen. The toggle will remain in the same spot. Hovering over a product will "highlight" the image of the product and the hover-badge will appear to show this is a product the user can click on. After the user clicks on a product, it will appear in the "COLLECT" section with a number.
*     If the user is using the "MULTI" selection, they can click the "Finish" button, which will transfer all of their "picks" into the "COLLECT" section. The pill which contains the finish button also includes the number of items being selected.
* **Add button** - (not fully functional) add to list that is specified in the "LISTS" section

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

In the **Manage Extensions** page, click on the **Errors** button. This would lead you to a new page where you can view the errors that are occurring. 
Using **Service Worker** helps you see any console alerts that occur during extension use. They are helpful for ensuring each aspect of the extension is working correctly.

## Notes
- At the time of switching over to the current version (version three) of the extension, the scraping files have been untouched. This was due to being directed to focus on the functionality of the extension. Comments regarding the state they are in are commented inside the files.
- API calls to the database are functional, however they are commented out due to needing a JWT Token in order to access lists or adding products.
