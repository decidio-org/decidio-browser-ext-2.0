# decidio-browser-extension
This is the repository for the Chrome and Safari browser extension. Created and maintained by Jenna Mena and Tahlia Kamieniecki


## Summary
The extension has an icon for when it is on/off. Once on, the toggle and the side panel appear and the user would be able to select products to add to their list. Details will be listed below, along with features that may need to be worked on/fixed


## Features

* **decidio. toggle button** - The square button on the upper right hand side of the screen. This button allows the user to toggle the side panel in or out. In Decidio Interaction Mode (Picker/DIM), you can click the toggle to cancel the action. Once products are being selected, the total number of products will be shown inside a red circle, much like how notifications look on mobile devices.
* **decidio side panel** - This is the body of the extension where the rest of the features reside in
* **LISTS section** - Contains a button with a sliding animation to show the option to create a list (not functional)
* **COLLECT section** - Contains an "add" button which triggers DIM. There is also the "SINGLE" and "MULTI" buttons which allows the user to select one or multiple products.
* **Decidio Interaction Mode (DIM)** - Upon activation, a semi-transparent overlay goes on top of the screen. The toggle will remain in the same spot. Hovering over a product will "highlight" the image of the product and the hover-badge will appear to show this is a product the user can click on. After the user clicks on a product, it will appear in the "COLLECT" section with a number. If the user is using the "MULTI" selection, they can click the "Finish" button, which will transfer all of their "picks" into the "COLLECT" section. The pill which contains the finish button also includes the number of items being selected.
* **Add button** - (not fully functional) add to list that is specified in the "LISTS" section

## Testing

## Prerequisites

This project requires **Node.js 24 LTS** (or newer) and npm.

Check whether you already have it:

```bash
node -v   # should print v24.x.x or higher
npm -v
```

If those commands aren't found, install Node using one of the options below.

### Option 1 — nvm (recommended)

A version manager keeps this project's Node version isolated from anything else
on your machine.

**macOS / Linux**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# restart your terminal, then:
nvm install 24
nvm use 24
```

**Windows** — install [nvm-windows](https://github.com/coreybutler/nvm-windows/releases),
then in a new terminal:

```powershell
nvm install 24
nvm use 24
```

### Option 2 — Official installer

Download the LTS installer from [nodejs.org](https://nodejs.org) and run it.
npm is bundled, so no separate install is needed.

### Option 3 — Package manager

```bash
# macOS (Homebrew)
brew install node@24

# Debian / Ubuntu
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# Windows (winget)
winget install OpenJS.NodeJS.LTS
```

### Verify

```bash
node -v
npm -v
```

Both should print a version. You're ready to install dependencies:

```bash
npm install
```
### Getting Started

This project can be used in Chrome and Safari, when starting up the project you should run **node build.js** to build the Safari and Chrome dist.

If you only wish to build one or the other run
**node build,js --chrome**
**node build.js --safari** 

 **Development builds only:** Safari refuses to load unsigned extensions until
> you opt in.
>
> 1. Go to **Safari → Settings… → Advanced** and enable
>    **Show features for web developers**.
> 2. In the new **Develop** menu, choose
>    **Developer Settings…** and tick **Allow unsigned extensions**.
>
> This setting resets every time Safari quits, so you'll need to re-enable it
> each session.

### Chrome Extension

1. Open the Chrome browser and head to **Extensions** -> **"Manage Extensions"**

2. Turn on Developer mode

3. Hit the button labeled **Load unpacked** and select the downloaded folder.

The extension is ready for testing. Pin the extension to the task bar for easy use.
    - Any changes done to the files in the folder the extension is linked to will require you to hit the **refresh** button.
    - After the extension has been refreshed, reload the site you are testing the extension on. The extension would now be up to date.


 ### Safari Extension
 1. Open Xcode and press the run button in the top left corner

 2.  Find the **Safari** tab in the toolbar.

 3. Select the **Safari Extensions** option.

 4. Find **Decidio** in the left-hand list and tick its checkbox to enable it.

 5. Click **Edit Websites…** (or the extension's entry) to grant access to the
   sites it needs — choose **Allow** for the domains you want it to run on. 

#### Handling Errors

In the **Manage Extensions** page, click on the **Errors** button. This would lead you to a new page where you can view the errors that are occurring. 
Using **Service Worker** helps you see any console alerts that occur during extension use. They are helpful for ensuring each aspect of the extension is working correctly.

## Notes
- At the time of switching over to the current version (version three) of the extension, the scraping files have been untouched. This was due to being directed to focus on the functionality of the extension. Comments regarding the state they are in are commented inside the files.
- API calls to the database are functional, however they are commented out due to needing a JWT Token in order to access lists or adding products.
